import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareValidation } from "../src/application/prepare-validation.js";
import {
	SessionSchema,
	ValidationStartInputSchema,
} from "../src/application/schema.js";
import {
	MAX_ARTIFACTS,
	MAX_SESSION_BYTES,
	MAX_TEXT_BYTES,
} from "../src/domain/limits.js";
import type { Session } from "../src/domain/session.js";
import { recordValidation } from "../src/domain/transitions.js";
import {
	loadSession,
	saveSession,
	sessionPath,
} from "../src/infrastructure/fs/workspace.js";
import {
	FEATURE,
	MemorySessionRepository,
	OUTPUT,
	SOURCE_A,
} from "./runtime-test-support.js";

function validationCapacitySession(artifactPathLength: number): Session {
	const priorRuns: Session["runs"] = Array.from(
		{ length: 4 },
		(_, runIndex) => ({
			id: `capacity-prior-${runIndex}`,
			featureId: FEATURE,
			attempt: runIndex + 1,
			state: "superseded",
			startedRevision: runIndex + 1,
			summary: null,
			artifactsChanged: Array.from(
				{ length: MAX_ARTIFACTS },
				(_, pathIndex) => {
					const prefix = `fill-${runIndex}-${pathIndex}-`;
					return {
						path: `${prefix}${"p".repeat(artifactPathLength - prefix.length)}`,
					};
				},
			),
			validations: [],
			reviews: [],
		}),
	);
	const active: Session["runs"][number] = {
		id: "capacity-active",
		featureId: FEATURE,
		attempt: 5,
		state: "active",
		startedRevision: 5,
		summary: null,
		artifactsChanged: [],
		validations: Array.from({ length: 63 }, (_, index) => ({
			id: `capacity-validation-${index}`,
			featureId: FEATURE,
			runId: "capacity-active",
			scope: "focused",
			command: "x".repeat(MAX_TEXT_BYTES),
			sourceDigest: SOURCE_A,
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
			recordedRevision: index + 6,
		})),
		reviews: [],
	};
	return {
		version: 5,
		id: "validation-capacity",
		revision: 68,
		goal: "Keep validation persistence within its byte budget",
		approval: "approved",
		plan: {
			summary: "Exercise validation capacity.",
			overview: "Keep the active run near the Session byte boundary.",
			requirements: [],
			decisions: [],
			features: [
				{
					id: FEATURE,
					title: "Runtime kernel",
					summary: "Exercise validation capacity.",
					targets: [],
					validation: [],
					dependsOn: [],
				},
			],
		},
		runs: [...priorRuns, active],
		operations: [],
		closure: null,
	};
}

describe("Flow validation capacity gate", () => {
	test("preflights and reloads a fitting 64th maximum command within the Session byte budget", async () => {
		const command = "x".repeat(MAX_TEXT_BYTES);
		const fitting = validationCapacitySession(4_020);
		expect(SessionSchema.parse(structuredClone(fitting))).toEqual(fitting);
		const fittingRepository = new MemorySessionRepository();
		fittingRepository.session = fitting;
		const fittingRequest = ValidationStartInputSchema.parse({
			request: {
				expectedRevision: fitting.revision,
				featureId: FEATURE,
				command,
				scope: "focused",
			},
		}).request;

		await expect(
			prepareValidation(fittingRepository, fittingRequest),
		).resolves.toMatchObject({ command, sourceDigest: SOURCE_A });
		const fittingProspective = recordValidation(fitting, {
			captureId: "capture-capacity-64",
			featureId: FEATURE,
			runId: "capacity-active",
			command,
			scope: "focused",
			sourceDigest: SOURCE_A,
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
		}).session;
		expect(
			Buffer.byteLength(JSON.stringify(fittingProspective, null, 2), "utf8"),
		).toBeGreaterThan(MAX_SESSION_BYTES);
		const workspace = await mkdtemp(join(tmpdir(), "flow-capacity-"));
		try {
			await saveSession(workspace, fittingProspective);
			const persistedBytes = (await stat(sessionPath(workspace))).size;
			expect(persistedBytes).toBe(
				Buffer.byteLength(JSON.stringify(fittingProspective), "utf8"),
			);
			expect(persistedBytes).toBeLessThanOrEqual(MAX_SESSION_BYTES);
			expect(await loadSession(workspace)).toEqual(fittingProspective);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}

		const overflowing = validationCapacitySession(4_080);
		expect(Buffer.byteLength(JSON.stringify(overflowing), "utf8")).toBeLessThan(
			MAX_SESSION_BYTES,
		);
		expect(SessionSchema.parse(structuredClone(overflowing))).toEqual(
			overflowing,
		);
		const prospective = recordValidation(overflowing, {
			captureId: "capture-capacity-64",
			featureId: FEATURE,
			runId: "capacity-active",
			command,
			scope: "focused",
			sourceDigest: SOURCE_A,
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
		}).session;
		expect(() => SessionSchema.parse(prospective)).toThrow(
			`Session cannot exceed ${MAX_SESSION_BYTES} UTF-8 bytes.`,
		);
		const overflowingRepository = new MemorySessionRepository();
		overflowingRepository.session = overflowing;
		const overflowingRequest = ValidationStartInputSchema.parse({
			request: {
				expectedRevision: overflowing.revision,
				featureId: FEATURE,
				command,
				scope: "focused",
			},
		}).request;

		await expect(
			prepareValidation(overflowingRepository, overflowingRequest),
		).rejects.toThrow(
			`Session cannot exceed ${MAX_SESSION_BYTES} UTF-8 bytes.`,
		);
		expect(overflowingRepository.session.runs.at(-1)?.validations).toHaveLength(
			63,
		);
	});
});
