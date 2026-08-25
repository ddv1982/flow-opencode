import { createHash } from "node:crypto";
import { link, mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson } from "./canonical-json.js";
import type { ValidatedCaseCatalog } from "./catalog.js";
import {
	type AttemptRecordV2,
	type CampaignCompletion,
	type CampaignPlan,
	CampaignPlanSchema,
	parseReport,
	type ValidatedReport,
} from "./report.js";

export type PersistenceCheckpoint =
	| "before-write"
	| "after-file-sync"
	| "after-rename"
	| "before-directory-sync";

export type ReportStoreHooks = {
	readonly checkpoint?: (checkpoint: PersistenceCheckpoint) => Promise<void>;
};

export class ReportStoreError extends Error {
	readonly code = "FLOW_REPORT_STORE";
}

type StoredAttempt = {
	readonly file: string;
	readonly value: unknown;
	readonly cellId: string | null;
};

function fail(message: string, cause?: unknown): never {
	throw new ReportStoreError(message, cause ? { cause } : undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cellId(value: unknown): string | null {
	return isRecord(value) && typeof value.cellId === "string"
		? value.cellId
		: null;
}

function attemptFileName(attemptId: string): string {
	return `${Buffer.from(attemptId).toString("base64url")}.json`;
}

function cellFileName(cellId: string): string {
	return `${Buffer.from(cellId).toString("base64url")}.json`;
}

function temporaryPath(path: string): string {
	return `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
}

function sha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function syncDirectory(directory: string): Promise<void> {
	try {
		const handle = await open(directory, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {
		// Windows and some filesystems do not permit opening directories for sync.
	}
}

async function checkpoint(
	hooks: ReportStoreHooks,
	name: PersistenceCheckpoint,
): Promise<void> {
	await hooks.checkpoint?.(name);
}

async function writeImmutable(
	path: string,
	bytes: Buffer,
	hooks: ReportStoreHooks,
): Promise<"written" | "replayed"> {
	try {
		const existing = await readFile(path);
		if (existing.equals(bytes)) return "replayed";
		fail(`Immutable report store entry conflicts: ${path}.`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	await checkpoint(hooks, "before-write");
	const temporary = temporaryPath(path);
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await checkpoint(hooks, "after-file-sync");
		try {
			await link(temporary, path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = await readFile(path);
			await unlink(temporary);
			await syncDirectory(dirname(path));
			if (existing.equals(bytes)) return "replayed";
			fail(`Immutable report store entry conflicts: ${path}.`);
		}
		await checkpoint(hooks, "after-rename");
		await unlink(temporary);
		await checkpoint(hooks, "before-directory-sync");
		await syncDirectory(dirname(path));
		return "written";
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		fail(`Could not read report store JSON: ${path}.`, error);
	}
}

export class ReportStore {
	private readonly attemptsDirectory: string;
	private readonly transcriptsDirectory: string;
	private readonly planPath: string;
	private readonly completionPath: string;
	private readonly reportPath: string;
	private readonly catalog: ValidatedCaseCatalog;
	private readonly hooks: ReportStoreHooks;

	constructor(
		directory: string,
		catalog: ValidatedCaseCatalog,
		hooks: ReportStoreHooks = {},
	) {
		this.catalog = catalog;
		this.hooks = hooks;
		this.attemptsDirectory = join(directory, "attempts");
		this.transcriptsDirectory = join(directory, "transcripts");
		this.planPath = join(directory, "plan.json");
		this.completionPath = join(directory, "completion.json");
		this.reportPath = join(directory, "report.json");
	}

	async initialize(plan: CampaignPlan): Promise<"written" | "replayed"> {
		await mkdir(this.attemptsDirectory, { recursive: true, mode: 0o700 });
		return writeImmutable(
			this.planPath,
			Buffer.from(canonicalJson(plan)),
			this.hooks,
		);
	}

	private async plan(): Promise<CampaignPlan> {
		const parsed = CampaignPlanSchema.safeParse(await readJson(this.planPath));
		if (!parsed.success) fail("Stored campaign plan is invalid.");
		return parsed.data;
	}

	private async attempts(): Promise<readonly StoredAttempt[]> {
		let files: string[];
		try {
			files = await readdir(this.attemptsDirectory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const attempts: StoredAttempt[] = [];
		for (const file of files
			.filter((entry) => entry.endsWith(".json"))
			.sort()) {
			const value = await readJson(join(this.attemptsDirectory, file));
			attempts.push({ file, value, cellId: cellId(value) });
		}
		return attempts;
	}

	async writeAttempt(
		attempt: AttemptRecordV2,
	): Promise<"written" | "replayed"> {
		const plan = await this.plan();
		if (!plan.cells.some((cell) => cell.cellId === attempt.cellId)) {
			fail(`Attempt references an unknown plan cell: ${attempt.cellId}.`);
		}
		return writeImmutable(
			join(this.attemptsDirectory, cellFileName(attempt.cellId)),
			Buffer.from(canonicalJson(attempt)),
			this.hooks,
		);
	}

	async writeTranscript(input: {
		readonly attemptId: string;
		readonly text: string;
	}): Promise<{ readonly artifact: string; readonly sha256: string }> {
		await mkdir(this.transcriptsDirectory, { recursive: true, mode: 0o700 });
		const artifact = `transcripts/${attemptFileName(input.attemptId)}`;
		const bytes = Buffer.from(input.text, "utf8");
		await writeImmutable(
			join(this.transcriptsDirectory, attemptFileName(input.attemptId)),
			bytes,
			this.hooks,
		);
		return { artifact, sha256: sha256(bytes) };
	}

	private orderedAttempts(
		plan: CampaignPlan,
		attempts: readonly StoredAttempt[],
	): readonly unknown[] {
		const ordered: unknown[] = [];
		const consumed = new Set<string>();
		for (const cell of plan.cells) {
			for (const attempt of attempts) {
				if (attempt.cellId === cell.cellId) {
					ordered.push(attempt.value);
					consumed.add(attempt.file);
				}
			}
		}
		for (const attempt of attempts) {
			if (!consumed.has(attempt.file)) ordered.push(attempt.value);
		}
		return ordered;
	}

	async finalize(input: {
		readonly reportId: string;
		readonly completion: CampaignCompletion;
		readonly allocationCommitmentSha256: string | null;
	}): Promise<ValidatedReport> {
		const plan = await this.plan();
		const report = {
			schemaVersion: 2,
			reportId: input.reportId,
			plan,
			attempts: this.orderedAttempts(plan, await this.attempts()),
			completion: input.completion,
			allocationCommitmentSha256: input.allocationCommitmentSha256,
		};
		const parsed = parseReport(report, this.catalog);
		if (!parsed.ok) {
			fail(
				`Refusing to finalize invalid report: ${parsed.issues
					.map((issue) => `${issue.path} ${issue.message}`)
					.join("; ")}`,
			);
		}
		const completionBytes = Buffer.from(canonicalJson(input.completion));
		const reportBytes = Buffer.from(canonicalJson(report));
		await writeImmutable(this.completionPath, completionBytes, this.hooks);
		await writeImmutable(this.reportPath, reportBytes, this.hooks);
		return parsed.value;
	}
}

export function createReportStore(input: {
	readonly directory: string;
	readonly catalog: ValidatedCaseCatalog;
	readonly hooks?: ReportStoreHooks;
}): ReportStore {
	return new ReportStore(input.directory, input.catalog, input.hooks);
}
