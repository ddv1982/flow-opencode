import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gradeDevelopmentProject } from "../evals/benchmark-grader.js";
import { DEVELOPMENT_CASES } from "../evals/development-cases.js";

export const KNOWN_GOOD_DEVELOPMENT_FILES: Readonly<
	Record<string, Readonly<Record<string, string>>>
> = {
	"settings-overlays": {
		"src/config/overlay.ts": `function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function overlay(base, patch) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(result, key, {
      value: isRecord(value) && isRecord(base[key]) ? overlay(base[key], value) : structuredClone(value),
      enumerable: true, configurable: true, writable: true,
    });
  }
  return result;
}
`,
	},
	"catalog-cursor-pages": {
		"packages/catalog/src/page.js": `import { compareRecords } from "./order.js";
export function pageRecords(records, cursor, limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid limit");
  const ordered = [...records].sort(compareRecords);
  const at = cursor === null ? -1 : ordered.findIndex((row) => row.id === cursor);
  if (cursor !== null && at < 0) throw new RangeError("Unknown cursor");
  const start = at + 1;
  const items = ordered.slice(start, start + limit);
  return { items, nextCursor: start + items.length < ordered.length ? items.at(-1).id : null };
}
`,
	},
	"calendar-interval-union": {
		"lib/calendar/intervals.ts": `export function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end < start) throw new RangeError("Reversed interval");
    if (start === end) continue;
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
`,
	},
	"stock-reservations": {
		"src/stock/index.js": `import { applyEvent } from "./events.js";
export function summarizeStock(initial, events) {
  if (!Number.isInteger(initial) || initial < 0) throw new RangeError("Invalid initial stock");
  const state = { available: initial, reservations: new Map() };
  for (const event of events) applyEvent(state, event);
  return { available: state.available, reservations: Object.fromEntries(state.reservations) };
}
`,
		"src/stock/events.js": `export function applyEvent(state, event) {
  if (event.type === "release") {
    state.available += state.reservations.get(event.id) ?? 0;
    state.reservations.delete(event.id);
    return;
  }
  if (!["receive", "reserve"].includes(event.type) || !Number.isInteger(event.quantity) || event.quantity < 1) throw new RangeError("Invalid event");
  if (event.type === "receive") { state.available += event.quantity; return; }
  if (state.reservations.has(event.id)) {
    if (state.reservations.get(event.id) !== event.quantity) throw new Error("Conflicting reservation");
    return;
  }
  if (event.quantity > state.available) throw new RangeError("Insufficient stock");
  state.available -= event.quantity;
  state.reservations.set(event.id, event.quantity);
}
`,
	},
	"csv-quoted-records": {
		"src/import/csv.ts": `export function parseCsv(text) {
  if (text === "") return [];
  const rows = [];
  let row = []; let cell = ""; let state = "start"; let endedRecord = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    endedRecord = false;
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else state = "closed";
      } else cell += char;
      continue;
    }
    const separator = char === "\\n" || (char === "\\r" && text[i + 1] === "\\n");
    if (state === "closed" && char !== "," && !separator) throw new Error("Characters after quote");
    if (char === ",") { row.push(cell); cell = ""; state = "start"; }
    else if (separator) {
      row.push(cell); rows.push(row); row = []; cell = ""; state = "start"; endedRecord = true;
      if (char === "\\r") i++;
    } else if (char === '"') {
      if (state !== "start") throw new Error("Quote in unquoted cell");
      state = "quoted";
    } else { cell += char; state = "bare"; }
  }
  if (state === "quoted") throw new Error("Unclosed quote");
  if (!endedRecord) { row.push(cell); rows.push(row); }
  return rows;
}
`,
	},
	"dependency-ready-batches": {
		"packages/planning/src/dependencies.js": `export function readyBatches(tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error("Duplicate task ID");
  if (tasks.some((task) => task.dependsOn.some((id) => !ids.has(id)))) throw new Error("Unknown dependency");
  const done = new Set(); const batches = [];
  while (done.size < tasks.length) {
    const batch = tasks.filter((task) => !done.has(task.id) && task.dependsOn.every((id) => done.has(id))).map((task) => task.id);
    if (!batch.length) throw new Error("Cycle");
    batches.push(batch);
    for (const id of batch) done.add(id);
  }
  return batches;
}
`,
	},
	"search-query-multimap": {
		"src/search/query.js": `export function parseQuery(query) {
  const values = new Map();
  const decode = (text) => decodeURIComponent(text.replaceAll("+", " "));
  for (const part of query.replace(/^\\?/, "").split("&").filter(Boolean)) {
    const at = part.indexOf("=");
    const key = decode(at < 0 ? part : part.slice(0, at));
    const value = decode(at < 0 ? "" : part.slice(at + 1));
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  return Object.fromEntries(values);
}
`,
	},
};

async function inProject<T>(
	files: Readonly<Record<string, string>>,
	check: (directory: string) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "corpus-check-"));
	try {
		for (const [path, contents] of Object.entries(files)) {
			const target = join(directory, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		}
		return await check(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe("development case corpus", () => {
	test("adds seven distinct contracts with honest provenance and unlabeled projects", () => {
		expect(DEVELOPMENT_CASES.length).toBeGreaterThanOrEqual(7);
		expect(new Set(DEVELOPMENT_CASES.map((item) => item.id)).size).toBe(
			DEVELOPMENT_CASES.length,
		);
		expect(new Set(DEVELOPMENT_CASES.map((item) => item.prompt)).size).toBe(
			DEVELOPMENT_CASES.length,
		);
		for (const item of DEVELOPMENT_CASES) {
			expect(item.provenance.kind).toBe("synthetic-development");
			expect(item.provenance.source.length).toBeGreaterThan(20);
			expect(item.probes.length).toBeGreaterThanOrEqual(4);
			expect(item.knownBadMutations.length).toBeGreaterThanOrEqual(2);
			expect(new Set(item.probes.map((probe) => probe.id)).size).toBe(
				item.probes.length,
			);
			expect(
				new Set(item.knownBadMutations.map((mutation) => mutation.id)).size,
			).toBe(item.knownBadMutations.length);
			expect(JSON.parse(JSON.stringify(item))).toEqual(item);
			const packageJson = JSON.parse(item.files["package.json"] ?? "null");
			expect(
				`${packageJson.name} ${item.prompt} ${Object.keys(item.files).join(" ")}`,
			).not.toMatch(/\b(?:flow|evals?|benchmarks?)\b/i);
			for (const probe of item.probes)
				expect(Object.hasOwn(item.files, probe.module)).toBe(true);
			expect(KNOWN_GOOD_DEVELOPMENT_FILES[item.id]).toBeDefined();
		}
	});

	test("covers both Node and Bun commands and nested modules", () => {
		const commands = DEVELOPMENT_CASES.map(
			(item) =>
				JSON.parse(item.files["package.json"] ?? "null").scripts.test as string,
		);
		expect(commands.some((command) => command.startsWith("node --test "))).toBe(
			true,
		);
		expect(commands.some((command) => command === "bun test")).toBe(true);
		expect(
			DEVELOPMENT_CASES.filter((item) =>
				Object.keys(item.files).some((path) => path.split("/").length >= 4),
			).length,
		).toBeGreaterThanOrEqual(2);
	});

	test("checks argument preservation for every contract that promises it", () => {
		const ids = new Set([
			"settings-overlays",
			"catalog-cursor-pages",
			"calendar-interval-union",
			"stock-reservations",
			"dependency-ready-batches",
		]);
		for (const item of DEVELOPMENT_CASES) {
			expect(item.probes.every((probe) => probe.preserveArgs === true)).toBe(
				ids.has(item.id),
			);
			if (ids.has(item.id))
				expect(
					item.knownBadMutations.some((mutation) =>
						mutation.id.startsWith("mutates-"),
					),
				).toBe(true);
		}
	});

	for (const item of DEVELOPMENT_CASES) {
		test(`${item.id} known good passes independent probes and its public command`, async () => {
			await inProject(
				{ ...item.files, ...KNOWN_GOOD_DEVELOPMENT_FILES[item.id] },
				async (directory) => {
					const result = await gradeDevelopmentProject(directory, item);
					expect(result).toEqual({ passed: true, issues: [] });
					const execution = spawnSync(process.execPath, ["run", "test"], {
						cwd: directory,
						encoding: "utf8",
						timeout: 10_000,
					});
					expect({
						status: execution.status,
						stdout: execution.stdout,
						stderr: execution.stderr,
					}).toMatchObject({ status: 0 });
				},
			);
		}, 30_000);

		test(`${item.id} rejects the starting defect`, async () => {
			await inProject(item.files, async (directory) => {
				const result = await gradeDevelopmentProject(directory, item);
				expect(result.passed).toBe(false);
				expect(result.issues.length).toBeGreaterThan(0);
			});
		}, 30_000);

		for (const mutation of item.knownBadMutations) {
			test(`${item.id} rejects mutation ${mutation.id}`, async () => {
				await inProject(
					{
						...item.files,
						...KNOWN_GOOD_DEVELOPMENT_FILES[item.id],
						...mutation.fileOverrides,
					},
					async (directory) => {
						if (mutation.id.startsWith("mutates-")) {
							const outputOnly = {
								...item,
								probes: item.probes.map(
									({ preserveArgs: _preserveArgs, ...probe }) => probe,
								),
							};
							expect(
								await gradeDevelopmentProject(directory, outputOnly),
							).toEqual({ passed: true, issues: [] });
						}
						const result = await gradeDevelopmentProject(directory, item);
						expect(result.passed).toBe(false);
						expect(result.issues.length).toBeGreaterThan(0);
					},
				);
			}, 30_000);
		}
	}
});
