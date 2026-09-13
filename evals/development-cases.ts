import type {
	BenchmarkProbe,
	DevelopmentCase,
	JsonValue,
} from "./benchmark-evidence.js";

function returns(
	id: string,
	module: string,
	exportName: string,
	args: readonly JsonValue[],
	value: JsonValue,
): BenchmarkProbe {
	return { id, module, exportName, args, expected: { kind: "return", value } };
}

function throws(
	id: string,
	module: string,
	exportName: string,
	args: readonly JsonValue[],
): BenchmarkProbe {
	return { id, module, exportName, args, expected: { kind: "throw" } };
}

function packageFile(name: string, command: string): string {
	return `${JSON.stringify({ name, private: true, type: "module", scripts: { test: command } }, null, 2)}\n`;
}

function preservingArgs(
	probes: readonly BenchmarkProbe[],
): readonly BenchmarkProbe[] {
	return probes.map((probe) => ({ ...probe, preserveArgs: true }));
}

export const DEVELOPMENT_CASES: readonly DevelopmentCase[] = [
	{
		id: "settings-overlays",
		caseVersion: 1,
		description:
			"Recursive configuration layers preserve explicit falsy values and replace arrays.",
		files: {
			"package.json": packageFile("layered-settings", "bun test"),
			"src/settings.ts": `import { overlay } from "./config/overlay.ts";
export function loadSettings(defaults, layers) {
  return layers.reduce((settings, layer) => overlay(settings, layer), structuredClone(defaults));
}
`,
			"src/config/overlay.ts": `export function overlay(base, patch) {
  return { ...base, ...patch };
}
`,
			"tests/settings.test.ts": `import { expect, test } from "bun:test";
import { loadSettings } from "../src/settings.ts";
test("changes the retry count", () => {
  expect(loadSettings({ retries: 2 }, [{ retries: 4 }])).toEqual({ retries: 4 });
});
`,
		},
		prompt:
			"Fix loadSettings in src/settings.ts and its helper. Apply layers from left to right. Merge nested objects recursively, replace arrays as whole values, and preserve explicit false, 0, empty strings, and null. Keys absent from a layer retain their previous values. Return a fresh result without mutating defaults or layers. Keep the existing public function and add tests for the edge cases.",
		probes: preservingArgs([
			returns(
				"nested-siblings",
				"src/settings.ts",
				"loadSettings",
				[
					{ ui: { color: "blue", size: 12 }, retries: 3 },
					[{ ui: { color: "red" } }],
				],
				{ ui: { color: "red", size: 12 }, retries: 3 },
			),
			returns(
				"explicit-falsy",
				"src/settings.ts",
				"loadSettings",
				[
					{ enabled: true, retries: 5, prefix: "x", fallback: { x: 1 } },
					[{ enabled: false, retries: 0, prefix: "", fallback: null }],
				],
				{ enabled: false, retries: 0, prefix: "", fallback: null },
			),
			returns(
				"replace-array",
				"src/settings.ts",
				"loadSettings",
				[
					{ targets: ["a", "b"], ui: { colors: ["red", "blue"], size: 9 } },
					[{ targets: [], ui: { colors: ["green"] } }],
				],
				{ targets: [], ui: { colors: ["green"], size: 9 } },
			),
			returns(
				"successive-nesting",
				"src/settings.ts",
				"loadSettings",
				[
					{ api: { host: "local", retry: { count: 2, delay: 8 } } },
					[{ api: { retry: { count: 0 } } }, { api: { retry: { delay: 3 } } }],
				],
				{ api: { host: "local", retry: { count: 0, delay: 3 } } },
			),
			returns(
				"replace-null-with-object",
				"src/settings.ts",
				"loadSettings",
				[{ cache: null }, [{ cache: { enabled: false } }]],
				{ cache: { enabled: false } },
			),
		]),
		knownBadMutations: [
			{
				id: "mutates-defaults",
				fileOverrides: {
					"src/settings.ts": `import { overlay } from "./config/overlay.ts";
export function loadSettings(defaults, layers) {
  const result = layers.reduce((settings, layer) => overlay(settings, layer), structuredClone(defaults));
  Object.assign(defaults, result);
  return result;
}
`,
				},
			},
			{
				id: "shallow-overlay",
				fileOverrides: {
					"src/config/overlay.ts":
						"export function overlay(base, patch) { return { ...base, ...patch }; }\n",
				},
			},
			{
				id: "truthy-overlay",
				fileOverrides: {
					"src/config/overlay.ts":
						"export function overlay(base, patch) { const result = structuredClone(base); for (const [key, value] of Object.entries(patch)) { if (value) result[key] = value; } return result; }\n",
				},
			},
		],
		provenance: {
			kind: "synthetic-development",
			source:
				"Authored for this corpus from common configuration merge failure patterns; no external repository lineage is claimed.",
		},
	},
	{
		id: "catalog-cursor-pages",
		caseVersion: 1,
		description:
			"Keyset pagination orders numeric ranks and stable IDs before applying a cursor.",
		files: {
			"package.json": packageFile(
				"catalog-service",
				"node --test packages/catalog/test/*.test.js",
			),
			"packages/catalog/src/order.js": `export function compareRecords(a, b) {
  return a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
`,
			"packages/catalog/src/page.js": `import { compareRecords } from "./order.js";
export function pageRecords(records, cursor, limit) {
  const start = cursor === null ? 0 : records.findIndex((row) => row.id === cursor) + 1;
  const items = records.slice(start, start + limit).sort(compareRecords);
  return { items, nextCursor: start + limit < records.length ? items.at(-1)?.id ?? null : null };
}
`,
			"packages/catalog/test/page.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { pageRecords } from "../src/page.js";
test("first page", () => {
  assert.deepEqual(pageRecords([{ id: "a", rank: 1 }, { id: "b", rank: 2 }], null, 1), { items: [{ id: "a", rank: 1 }], nextCursor: "a" });
});
`,
		},
		prompt:
			"Fix pageRecords in packages/catalog/src/page.js. Return records ordered by numeric rank ascending, then by ID using JavaScript string ordering. Apply the cursor after sorting, excluding the record with that ID. A null cursor starts at the beginning. Return { items, nextCursor }, with nextCursor equal to the last returned ID only when more records remain, otherwise null. Reject unknown non-null cursors and limits that are not positive integers. Input record IDs are unique. Do not mutate the input array. Keep the Node test script and add regression tests.",
		probes: preservingArgs([
			returns(
				"sort-before-window",
				"packages/catalog/src/page.js",
				"pageRecords",
				[
					[
						{ id: "z", rank: 11 },
						{ id: "b", rank: 2 },
						{ id: "a", rank: 2 },
						{ id: "c", rank: 3 },
					],
					null,
					2,
				],
				{
					items: [
						{ id: "a", rank: 2 },
						{ id: "b", rank: 2 },
					],
					nextCursor: "b",
				},
			),
			returns(
				"cursor-in-sorted-order",
				"packages/catalog/src/page.js",
				"pageRecords",
				[
					[
						{ id: "d", rank: 8 },
						{ id: "b", rank: 2 },
						{ id: "a", rank: 2 },
						{ id: "c", rank: 3 },
					],
					"a",
					2,
				],
				{
					items: [
						{ id: "b", rank: 2 },
						{ id: "c", rank: 3 },
					],
					nextCursor: "c",
				},
			),
			returns(
				"terminal-page",
				"packages/catalog/src/page.js",
				"pageRecords",
				[
					[
						{ id: "b", rank: 2 },
						{ id: "a", rank: 1 },
					],
					"b",
					3,
				],
				{ items: [], nextCursor: null },
			),
			returns(
				"empty-page",
				"packages/catalog/src/page.js",
				"pageRecords",
				[[], null, 1],
				{ items: [], nextCursor: null },
			),
			throws("unknown-cursor", "packages/catalog/src/page.js", "pageRecords", [
				[{ id: "a", rank: 1 }],
				"missing",
				1,
			]),
			throws("zero-limit", "packages/catalog/src/page.js", "pageRecords", [
				[],
				null,
				0,
			]),
			throws(
				"fractional-limit",
				"packages/catalog/src/page.js",
				"pageRecords",
				[[], null, 1.5],
			),
		]),
		knownBadMutations: [
			{
				id: "mutates-record-order",
				fileOverrides: {
					"packages/catalog/src/page.js": `import { compareRecords } from "./order.js";
export function pageRecords(records, cursor, limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid limit");
  const ordered = records.sort(compareRecords);
  const at = cursor === null ? -1 : ordered.findIndex((row) => row.id === cursor);
  if (cursor !== null && at < 0) throw new RangeError("Unknown cursor");
  const start = at + 1;
  const items = ordered.slice(start, start + limit);
  return { items, nextCursor: start + items.length < ordered.length ? items.at(-1).id : null };
}
`,
				},
			},
			{
				id: "window-before-sort",
				fileOverrides: {
					"packages/catalog/src/page.js": `import { compareRecords } from "./order.js";
export function pageRecords(records, cursor, limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid limit");
  const at = cursor === null ? -1 : records.findIndex((row) => row.id === cursor);
  if (cursor !== null && at < 0) throw new RangeError("Unknown cursor");
  const items = records.slice(at + 1, at + 1 + limit).sort(compareRecords);
  return { items, nextCursor: at + 1 + limit < records.length ? items.at(-1).id : null };
}
`,
				},
			},
			{
				id: "ignore-cursor",
				fileOverrides: {
					"packages/catalog/src/page.js": `import { compareRecords } from "./order.js";
export function pageRecords(records, cursor, limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid limit");
  if (cursor !== null && !records.some((row) => row.id === cursor)) throw new RangeError("Unknown cursor");
  const items = [...records].sort(compareRecords).slice(0, limit);
  return { items, nextCursor: limit < records.length ? items.at(-1).id : null };
}
`,
				},
			},
		],
		provenance: {
			kind: "synthetic-development",
			source:
				"Authored for this corpus to exercise ordering and pagination boundaries; no external repository lineage is claimed.",
		},
	},
	{
		id: "calendar-interval-union",
		caseVersion: 1,
		description:
			"Nested and touching time intervals coalesce without shrinking an existing span.",
		files: {
			"package.json": packageFile("calendar-widgets", "bun test"),
			"lib/calendar/index.ts":
				"export { mergeIntervals } from './intervals.ts';\n",
			"lib/calendar/intervals.ts": `export function mergeIntervals(intervals) {
  const result = [];
  for (const pair of [...intervals].sort((a, b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && pair[0] <= previous[1]) previous[1] = pair[1];
    else result.push([...pair]);
  }
  return result;
}
`,
			"test/calendar.test.ts": `import { expect, test } from "bun:test";
import { mergeIntervals } from "../lib/calendar/index.ts";
test("joins overlapping spans", () => expect(mergeIntervals([[1, 3], [2, 5]])).toEqual([[1, 5]]));
`,
		},
		prompt:
			"Repair mergeIntervals exported from lib/calendar/index.ts. Inputs are pairs of finite numbers describing half-open intervals. Sort by start and merge overlapping or touching intervals, keeping the greatest end when intervals nest. Omit zero-length intervals. Throw for a reversed interval. Return new pairs without changing the input. Add regression tests for nested, touching, empty, and reversed intervals.",
		probes: preservingArgs([
			returns(
				"nested-end",
				"lib/calendar/index.ts",
				"mergeIntervals",
				[
					[
						[1, 10],
						[2, 3],
						[4, 8],
					],
				],
				[[1, 10]],
			),
			returns(
				"touching-chain",
				"lib/calendar/index.ts",
				"mergeIntervals",
				[
					[
						[8, 10],
						[1, 3],
						[3, 8],
					],
				],
				[[1, 10]],
			),
			returns(
				"empty-intervals",
				"lib/calendar/index.ts",
				"mergeIntervals",
				[
					[
						[2, 2],
						[4, 4],
					],
				],
				[],
			),
			returns(
				"negative-separated",
				"lib/calendar/index.ts",
				"mergeIntervals",
				[
					[
						[5, 7],
						[-3, -1],
						[-2, 0],
						[1, 1],
					],
				],
				[
					[-3, 0],
					[5, 7],
				],
			),
			returns(
				"equal-starts",
				"lib/calendar/index.ts",
				"mergeIntervals",
				[
					[
						[1, 8],
						[1, 3],
						[8, 9],
					],
				],
				[[1, 9]],
			),
			throws("reversed", "lib/calendar/index.ts", "mergeIntervals", [[[3, 2]]]),
		]),
		knownBadMutations: [
			{
				id: "mutates-interval-order",
				fileOverrides: {
					"lib/calendar/intervals.ts": `export function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
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
			},
			{
				id: "nested-span-shrinks",
				fileOverrides: {
					"lib/calendar/intervals.ts": `export function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end < start) throw new RangeError("Reversed interval");
    if (start === end) continue;
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = end;
    else result.push([start, end]);
  }
  return result;
}
`,
				},
			},
			{
				id: "touching-spans-separated",
				fileOverrides: {
					"lib/calendar/intervals.ts": `export function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end < start) throw new RangeError("Reversed interval");
    if (start === end) continue;
    const last = result.at(-1);
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
`,
				},
			},
		],
		provenance: {
			kind: "synthetic-development",
			source:
				"Authored for this corpus from interval union edge cases; no external repository lineage is claimed.",
		},
	},
	{
		id: "stock-reservations",
		caseVersion: 1,
		description:
			"A reservation reducer handles retries, releases, and invalid stock transitions.",
		files: {
			"package.json": packageFile("stock-room", "node --test test/*.test.js"),
			"src/stock/index.js": `import { applyEvent } from "./events.js";
export function summarizeStock(initial, events) {
  const state = { available: initial, reservations: new Map() };
  for (const event of events) applyEvent(state, event);
  return { available: state.available, reservations: Object.fromEntries(state.reservations) };
}
`,
			"src/stock/events.js": `export function applyEvent(state, event) {
  if (event.type === "reserve") {
    state.available -= event.quantity;
    state.reservations.set(event.id, event.quantity);
  } else if (event.type === "release") {
    state.available += state.reservations.get(event.id) ?? 0;
    state.reservations.delete(event.id);
  } else {
    state.available += event.quantity;
  }
}
`,
			"test/stock.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeStock } from "../src/stock/index.js";
test("reserves available stock", () => assert.deepEqual(summarizeStock(5, [{ type: "reserve", id: "r1", quantity: 2 }]), { available: 3, reservations: { r1: 2 } }));
`,
		},
		prompt:
			"Fix summarizeStock and its event reducer under src/stock. Starting from a nonnegative integer stock count, process receive events with a positive integer quantity, reserve events with an ID and positive integer quantity, and release events with an ID. An identical reserve retry for an active ID is a no-op. A retry with a different quantity must throw. Reserving more than available stock must throw. Releasing an absent ID is a no-op. A released ID may be reserved again. Reject invalid quantities, invalid initial stock, and unknown event types. Return { available, reservations } where reservations is an object of active ID-to-quantity entries. Do not mutate the input events. Preserve the Node test command and extend its coverage.",
		probes: preservingArgs([
			returns(
				"reserve-retry",
				"src/stock/index.js",
				"summarizeStock",
				[
					8,
					[
						{ type: "reserve", id: "r", quantity: 3 },
						{ type: "reserve", id: "r", quantity: 3 },
					],
				],
				{ available: 5, reservations: { r: 3 } },
			),
			returns(
				"release-and-reuse",
				"src/stock/index.js",
				"summarizeStock",
				[
					4,
					[
						{ type: "reserve", id: "r", quantity: 4 },
						{ type: "release", id: "r" },
						{ type: "release", id: "r" },
						{ type: "reserve", id: "r", quantity: 2 },
						{ type: "receive", quantity: 3 },
					],
				],
				{ available: 5, reservations: { r: 2 } },
			),
			returns(
				"multiple-active",
				"src/stock/index.js",
				"summarizeStock",
				[
					9,
					[
						{ type: "reserve", id: "a", quantity: 2 },
						{ type: "reserve", id: "b", quantity: 3 },
						{ type: "release", id: "a" },
					],
				],
				{ available: 6, reservations: { b: 3 } },
			),
			throws("conflicting-retry", "src/stock/index.js", "summarizeStock", [
				8,
				[
					{ type: "reserve", id: "r", quantity: 3 },
					{ type: "reserve", id: "r", quantity: 2 },
				],
			]),
			throws("insufficient-stock", "src/stock/index.js", "summarizeStock", [
				2,
				[{ type: "reserve", id: "r", quantity: 3 }],
			]),
			throws("fractional-quantity", "src/stock/index.js", "summarizeStock", [
				5,
				[{ type: "receive", quantity: 1.5 }],
			]),
			throws("negative-initial", "src/stock/index.js", "summarizeStock", [
				-1,
				[],
			]),
			throws("unknown-event", "src/stock/index.js", "summarizeStock", [
				5,
				[{ type: "discard", quantity: 1 }],
			]),
		]),
		knownBadMutations: [
			{
				id: "mutates-event-list",
				fileOverrides: {
					"src/stock/index.js": `import { applyEvent } from "./events.js";
export function summarizeStock(initial, events) {
  if (!Number.isInteger(initial) || initial < 0) throw new RangeError("Invalid initial stock");
  const state = { available: initial, reservations: new Map() };
  while (events.length > 0) applyEvent(state, events.shift());
  return { available: state.available, reservations: Object.fromEntries(state.reservations) };
}
`,
				},
			},
			{
				id: "debit-retries",
				fileOverrides: {
					"src/stock/events.js": `export function applyEvent(state, event) {
  if (event.type === "release") { state.available += state.reservations.get(event.id) ?? 0; state.reservations.delete(event.id); return; }
  if (!["receive", "reserve"].includes(event.type) || !Number.isInteger(event.quantity) || event.quantity < 1) throw new RangeError("Invalid event");
  if (event.type === "receive") { state.available += event.quantity; return; }
  if (state.reservations.has(event.id) && state.reservations.get(event.id) !== event.quantity) throw new Error("Conflicting reservation");
  if (event.quantity > state.available) throw new RangeError("Insufficient stock");
  state.available -= event.quantity;
  state.reservations.set(event.id, event.quantity);
}
`,
				},
			},
			{
				id: "permit-overreservation",
				fileOverrides: {
					"src/stock/events.js": `export function applyEvent(state, event) {
  if (event.type === "release") { state.available += state.reservations.get(event.id) ?? 0; state.reservations.delete(event.id); return; }
  if (!["receive", "reserve"].includes(event.type) || !Number.isInteger(event.quantity) || event.quantity < 1) throw new RangeError("Invalid event");
  if (event.type === "receive") { state.available += event.quantity; return; }
  if (state.reservations.has(event.id)) { if (state.reservations.get(event.id) !== event.quantity) throw new Error("Conflicting reservation"); return; }
  state.available -= event.quantity;
  state.reservations.set(event.id, event.quantity);
}
`,
				},
			},
		],
		provenance: {
			kind: "synthetic-development",
			source:
				"Authored for this corpus to exercise idempotent event processing and conservation of stock; no external repository lineage is claimed.",
		},
	},
	{
		id: "csv-quoted-records",
		caseVersion: 1,
		description:
			"CSV records preserve escaped quotes, embedded newlines, and empty cells.",
		files: {
			"package.json": packageFile("table-import", "bun test"),
			"src/import/index.ts": "export { parseCsv } from './csv.ts';\n",
			"src/import/csv.ts": `export function parseCsv(text) {
  if (text === "") return [];
  return text.trimEnd().split(/\\r?\\n/).map((line) => line.split(","));
}
`,
			"tests/import.test.ts": `import { expect, test } from "bun:test";
import { parseCsv } from "../src/import/index.ts";
test("reads two columns", () => expect(parseCsv("a,b\\n1,2")).toEqual([["a", "b"], ["1", "2"]]));
`,
		},
		prompt:
			"Implement parseCsv exported from src/import/index.ts. Return string rows. Support commas, LF and CRLF record separators, quoted cells containing commas or newlines, and doubled quotes inside quoted cells. Quotes may open only at the beginning of a cell. After a closing quote allow only a delimiter, record separator, or end of input. Throw on malformed or unterminated quoting. Preserve whitespace, empty cells, and empty records. A final record separator closes the last row without adding another row. Empty input returns []. Add focused parser tests.",
		probes: [
			returns(
				"quoted-comma",
				"src/import/index.ts",
				"parseCsv",
				['name,note\r\nAda,"a,b"\r\n'],
				[
					["name", "note"],
					["Ada", "a,b"],
				],
			),
			returns(
				"escaped-quote-and-line",
				"src/import/index.ts",
				"parseCsv",
				['"a""b","line1\nline2",\n'],
				[['a"b', "line1\nline2", ""]],
			),
			returns(
				"whitespace-and-empty-record",
				"src/import/index.ts",
				"parseCsv",
				["x,  \n\n"],
				[["x", "  "], [""]],
			),
			returns("empty-input", "src/import/index.ts", "parseCsv", [""], []),
			returns(
				"single-empty-quoted-cell",
				"src/import/index.ts",
				"parseCsv",
				['""'],
				[[""]],
			),
			throws("unterminated-quote", "src/import/index.ts", "parseCsv", ['a,"b']),
			throws("trailing-characters", "src/import/index.ts", "parseCsv", [
				'"a"x,b',
			]),
			throws("quote-in-unquoted-cell", "src/import/index.ts", "parseCsv", [
				'a"b,c',
			]),
		],
		knownBadMutations: [
			{
				id: "delimiter-split",
				fileOverrides: {
					"src/import/csv.ts":
						"export function parseCsv(text) { return text === '' ? [] : text.replace(/\\r?\\n$/, '').split(/\\r?\\n/).map((line) => line.split(',')); }\n",
				},
			},
			{
				id: "strip-quotes-per-line",
				fileOverrides: {
					"src/import/csv.ts": `export function parseCsv(text) {
  if (text === "") return [];
  return text.replace(/\\r?\\n$/, "").split(/\\r?\\n/).map((line) => {
    if ((line.match(/"/g) ?? []).length % 2) throw new Error("Unclosed quote");
    return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^"|"$/g, "").replaceAll('""', '"'));
  });
}
`,
				},
			},
		],
		provenance: {
			kind: "synthetic-development",
			source:
				"Authored for this corpus around common delimited-text parser bugs; no external repository lineage is claimed.",
		},
	},
	{
		id: "dependency-ready-batches",
		caseVersion: 1,
		description:
			"Dependency batches respect prerequisites and reject unknown or cyclic graphs.",
		files: {
			"package.json": packageFile(
				"project-planner",
				"node --test test/*.test.js",
			),
			"packages/planning/index.js":
				"export { readyBatches } from './src/dependencies.js';\n",
			"packages/planning/src/dependencies.js": `export function readyBatches(tasks) {
  const roots = tasks.filter((task) => task.dependsOn.length === 0).map((task) => task.id);
  const rest = tasks.filter((task) => task.dependsOn.length > 0).map((task) => task.id);
  return [roots, rest].filter((batch) => batch.length > 0);
}
`,
			"test/planning.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { readyBatches } from "../packages/planning/index.js";
test("one prerequisite", () => assert.deepEqual(readyBatches([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: ["a"] }]), [["a"], ["b"]]));
`,
		},
		prompt:
			"Fix readyBatches exported from packages/planning/index.js. Each batch contains tasks whose dependencies were completed in earlier batches. Preserve input order within each batch. A task becoming ready during a batch belongs in the next batch. Duplicate dependency references count once. Return [] for no tasks. Throw for duplicate task IDs, unknown dependencies, or dependency cycles. Keep the input untouched and add Node tests for the failure cases and multi-level graphs.",
		probes: preservingArgs([
			returns(
				"three-level-diamond",
				"packages/planning/index.js",
				"readyBatches",
				[
					[
						{ id: "publish", dependsOn: ["compile", "check"] },
						{ id: "compile", dependsOn: ["fetch"] },
						{ id: "check", dependsOn: ["fetch"] },
						{ id: "fetch", dependsOn: [] },
					],
				],
				[["fetch"], ["compile", "check"], ["publish"]],
			),
			returns(
				"stable-ready-order",
				"packages/planning/index.js",
				"readyBatches",
				[
					[
						{ id: "z", dependsOn: [] },
						{ id: "b", dependsOn: ["z"] },
						{ id: "a", dependsOn: [] },
						{ id: "c", dependsOn: ["a"] },
					],
				],
				[
					["z", "a"],
					["b", "c"],
				],
			),
			returns(
				"duplicate-dependency",
				"packages/planning/index.js",
				"readyBatches",
				[
					[
						{ id: "b", dependsOn: ["a", "a"] },
						{ id: "a", dependsOn: [] },
					],
				],
				[["a"], ["b"]],
			),
			returns(
				"empty-graph",
				"packages/planning/index.js",
				"readyBatches",
				[[]],
				[],
			),
			throws("cycle", "packages/planning/index.js", "readyBatches", [
				[
					{ id: "a", dependsOn: ["b"] },
					{ id: "b", dependsOn: ["a"] },
				],
			]),
			throws(
				"unknown-dependency",
				"packages/planning/index.js",
				"readyBatches",
				[[{ id: "a", dependsOn: ["missing"] }]],
			),
			throws("duplicate-id", "packages/planning/index.js", "readyBatches", [
				[
					{ id: "a", dependsOn: [] },
					{ id: "a", dependsOn: [] },
				],
			]),
		]),
		knownBadMutations: [
			{
				id: "mutates-task-list",
				fileOverrides: {
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
  tasks.splice(0, tasks.length);
  return batches;
}
`,
				},
			},
			{
				id: "two-batches-only",
				fileOverrides: {
					"packages/planning/src/dependencies.js": `export function readyBatches(tasks) {
  return [tasks.filter((task) => !task.dependsOn.length).map((task) => task.id), tasks.filter((task) => task.dependsOn.length).map((task) => task.id)].filter((batch) => batch.length);
}
`,
				},
			},
			{
				id: "same-batch-readiness",
				fileOverrides: {
					"packages/planning/src/dependencies.js": `export function readyBatches(tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length || tasks.some((task) => task.dependsOn.some((id) => !ids.has(id)))) throw new Error("Invalid graph");
  const done = new Set(); const batches = [];
  while (done.size < tasks.length) {
    const batch = [];
    for (const task of tasks) if (!done.has(task.id) && task.dependsOn.every((id) => done.has(id))) { batch.push(task.id); done.add(task.id); }
    if (!batch.length) throw new Error("Cycle");
    batches.push(batch);
  }
  return batches;
}
`,
				},
			},
		],
		provenance: {
			kind: "synthetic-development",
			source:
				"Authored for this corpus to exercise graph ordering and invalid-reference handling; no external repository lineage is claimed.",
		},
	},
	{
		id: "search-query-multimap",
		caseVersion: 1,
		description:
			"URL query parsing preserves repeated keys, form encoding, and empty values.",
		files: {
			"package.json": packageFile(
				"search-links",
				"node --test tests/*.test.js",
			),
			"src/search/index.js": "export { parseQuery } from './query.js';\n",
			"src/search/query.js": `export function parseQuery(query) {
  return Object.fromEntries(query.replace(/^\\?/, "").split("&").filter(Boolean).map((part) => {
    const [key, value = ""] = part.split("=");
    return [decodeURIComponent(key), [decodeURIComponent(value)]];
  }));
}
`,
			"tests/query.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/search/index.js";
test("decodes one value", () => assert.deepEqual(parseQuery("?q=hello%20world"), { q: ["hello world"] }));
`,
		},
		prompt:
			"Fix parseQuery exported from src/search/index.js. Accept an optional leading question mark. Parse ampersand-separated query entries into an object whose values are arrays in encounter order. Ignore empty entries. Split each entry at its first equals sign, treating a missing equals sign as an empty value. Decode percent escapes and replace plus with a space before decoding. Empty keys are allowed. Repeated keys append values. Treat every key, including object prototype property names, as ordinary data. Throw on malformed percent encoding. Keep Node tests and add regression coverage.",
		probes: [
			returns(
				"repeated-keys",
				"src/search/index.js",
				"parseQuery",
				["?tag=one&tag=two&tag="],
				{ tag: ["one", "two", ""] },
			),
			returns(
				"plus-and-literal-plus",
				"src/search/index.js",
				"parseQuery",
				["q=two+words&q=two%2Bwords&first+name=Ada"],
				{ q: ["two words", "two+words"], "first name": ["Ada"] },
			),
			returns(
				"equals-in-value",
				"src/search/index.js",
				"parseQuery",
				["token=a=b=c&flag&=blank&&"],
				{ token: ["a=b=c"], flag: [""], "": ["blank"] },
			),
			returns(
				"prototype-keys",
				"src/search/index.js",
				"parseQuery",
				["__proto__=safe&constructor=x&__proto__=again"],
				{ ["__proto__"]: ["safe", "again"], constructor: ["x"] },
			),
			returns(
				"unicode-value",
				"src/search/index.js",
				"parseQuery",
				["q=%E2%98%83"],
				{ q: ["☃"] },
			),
			returns("empty-query", "src/search/index.js", "parseQuery", ["?&&"], {}),
			throws("malformed-escape", "src/search/index.js", "parseQuery", [
				"q=%E0%A4",
			]),
		],
		knownBadMutations: [
			{
				id: "last-value-wins",
				fileOverrides: {
					"src/search/query.js": `export function parseQuery(query) {
  const pairs = [];
  for (const part of query.replace(/^\\?/, "").split("&").filter(Boolean)) {
    const at = part.indexOf("=");
    const decode = (text) => decodeURIComponent(text.replaceAll("+", " "));
    pairs.push([decode(at < 0 ? part : part.slice(0, at)), [decode(at < 0 ? "" : part.slice(at + 1))]]);
  }
  return Object.fromEntries(pairs);
}
`,
				},
			},
			{
				id: "literal-plus",
				fileOverrides: {
					"src/search/query.js": `export function parseQuery(query) {
  const values = new Map();
  for (const part of query.replace(/^\\?/, "").split("&").filter(Boolean)) {
    const at = part.indexOf("=");
    const key = decodeURIComponent(at < 0 ? part : part.slice(0, at));
    const value = decodeURIComponent(at < 0 ? "" : part.slice(at + 1));
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  return Object.fromEntries(values);
}
`,
				},
			},
		],
		provenance: {
			kind: "synthetic-development",
			source:
				"Authored for this corpus around URL query decoding and repeated-key handling; no external repository lineage is claimed.",
		},
	},
];
