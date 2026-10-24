import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionMessageAssistantTool } from "@opencode/client";
import { SessionSchema } from "../../src/application/schema.js";
import { normalizeEvidencePlatform } from "../../src/domain/validation.js";
import { createFileSourceIdentityProvider } from "../../src/infrastructure/fs/source-identity.js";

const platform = normalizeEvidencePlatform(process.platform);

export const validationCommands = {
	pass: "printf flow-smoke-pass",
	nonzero: "printf flow-smoke-nonzero; exit 7",
	timeout: "/bin/sleep 2",
	error: "printf flow-smoke-error",
	large:
		"/usr/bin/awk 'BEGIN { for (i=0;i<20000;i++) print \"native-smoke-output\" }'",
	junit: "./native-junit.sh --reporter-outfile=.flow/results.xml",
	stale: "./native-junit-stale.sh --reporter-outfile=.flow/results.xml",
} as const;
const named = "smoke named assertion";
export const packedValidationPlan = {
	summary: "Verify native capture against the installed candidate",
	overview: "Only the disposable fixture is used for native shell evidence.",
	requirements: ["Capture exact source-bound native validation"],
	decisions: ["No remote provider"],
	features: [
		{
			id: "native-check",
			title: "Native capture",
			summary: "Exercise native shell outcomes",
			targets: ["README.md"],
			validation: Object.values(validationCommands),
			dependsOn: [],
			checks: Object.entries(validationCommands).map(([key, command]) => ({
				command,
				intent: "pass",
				platform,
				...(["junit", "stale"].includes(key) ? { assertions: [named] } : {}),
			})),
		},
		{
			id: "native-return",
			title: "Native reviewer return",
			summary: "Complete a fresh independently reviewed native gate",
			targets: ["README.md"],
			validation: [validationCommands.pass],
			dependsOn: [],
			checks: [{ command: validationCommands.pass, intent: "pass", platform }],
		},
	],
	evidence: [
		{
			scope: "gate",
			requirement: "Local gate",
			environment: "Isolated host",
			command: validationCommands.pass,
			platform,
			assertions: [],
		},
	],
};

type Dispatch = (
	agent: string,
	actions: { tool: string; input: Record<string, unknown> }[],
) => Promise<{ calls: SessionMessageAssistantTool[] }>;
export async function runPackedValidationCases(
	project: string,
	dispatch: Dispatch,
	evidence: unknown[],
) {
	const session = async () =>
		SessionSchema.parse(
			JSON.parse(await readFile(join(project, ".flow/session.json"), "utf8")),
		);
	const flow = async (tool: string, request: Record<string, unknown>) => {
		const result = await dispatch("build", [{ tool, input: { request } }]);
		const call = result.calls.findLast((call) => call.name === tool);
		if (call?.state.status !== "completed")
			throw new Error(`Native ${tool} did not complete`);
		const content = call.state.content
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n");
		const response: unknown = JSON.parse(content);
		expect(response).toMatchObject({ status: "ok" });
		return call;
	};
	await flow("flow_plan_approve", {
		operationId: "smoke-approve",
		expectedRevision: (await session()).revision,
	});
	await flow("flow_run_start", {
		operationId: "smoke-run",
		expectedRevision: (await session()).revision,
		featureId: "native-check",
	});
	const sourceDigest =
		await createFileSourceIdentityProvider(project).computeSourceDigest();
	const failures: Error[] = [];
	for (const [kind, command] of Object.entries(validationCommands)) {
		const before = await session();
		if (kind === "stale")
			await writeFile(
				join(project, ".flow/results.xml"),
				'<testsuites><testsuite tests="1"><testcase name="smoke named assertion"/></testsuite></testsuites>',
			);
		const result = await dispatch("build", [
			{
				tool: "flow_validation_start",
				input: {
					request: {
						expectedRevision: before.revision,
						featureId: "native-check",
						command,
						scope: kind === "pass" ? "broad" : "focused",
						...(["junit", "stale"].includes(kind)
							? { resultsPath: ".flow/results.xml" }
							: {}),
					},
				},
			},
			{
				tool: "shell",
				input: {
					command,
					description: `Native ${kind} validation`,
					...(kind === "timeout" ? { timeout: 10 } : {}),
					...(kind === "error"
						? { workdir: join(project, "absent-workdir") }
						: {}),
				},
			},
		]);
		const armed = result.calls.find(
			(call) => call.name === "flow_validation_start",
		);
		if (armed?.state.status !== "completed")
			throw new Error("Native validation arming did not complete");
		expect(
			JSON.parse(
				armed.state.content
					.filter((item) => item.type === "text")
					.map((item) => item.text)
					.join("\n"),
			),
		).toMatchObject({ status: "ok" });
		const after = await session();
		const observations = after.runs.at(-1)?.validations ?? [];
		const record = observations.at(-1);
		evidence.push({
			kind,
			command,
			sourceDigest,
			beforeRevision: before.revision,
			afterRevision: after.revision,
			record,
			calls: result.calls.map((call) => ({
				name: call.name,
				state: call.state.status,
				time: call.time,
				...(call.state.status === "streaming"
					? {}
					: { metadata: call.state.metadata }),
			})),
		});
		try {
			if (kind === "error") {
				expect(
					result.calls
						.filter((call) => call.name === "shell")
						.map((call) => [call.name, call.state.status]),
				).toEqual([["shell", "error"]]);
				expect(observations.length).toBe(
					before.runs.at(-1)?.validations.length ?? 0,
				);
				continue;
			}
			expect(record?.command).toBe(command);
			expect(record?.sourceDigest).toBe(sourceDigest);
			expect(record?.runId).toBe(after.runs.at(-1)?.id);
			if (kind === "timeout") {
				expect(record?.exitCode).toBeNull();
				expect(record?.outputComplete).toBe(false);
				expect(record?.ineligibleReason).toBe("exit-code-unavailable");
			} else {
				expect(record?.exitCode).toBe(kind === "nonzero" ? 7 : 0);
				expect(record?.outputComplete).toBe(true);
				expect(record?.ineligibleReason).toBeUndefined();
			}
			if (kind === "large")
				expect(record?.outputDigest).toBe(
					`sha256:${createHash("sha256").update("native-smoke-output\n".repeat(20000)).digest("hex")}`,
				);
			if (kind === "junit")
				expect(record?.observedAssertions).toEqual([
					{ name: named, status: "passed" },
				]);
			if (kind === "stale")
				expect(record?.observedAssertions).toEqual([
					{ name: named, status: "absent" },
				]);
		} catch (error) {
			failures.push(error instanceof Error ? error : new Error(String(error)));
		}
	}
	return { sourceDigest, failures };
}

export const junitFixtureFiles = {
	"native-junit.sh":
		'#!/bin/sh\nsleep 0.05\nprintf \'%s\' \'<testsuites><testsuite tests="1" failures="0"><testcase name="smoke named assertion"/></testsuite></testsuites>\' > .flow/results.xml\n',
	"native-junit-stale.sh": "#!/bin/sh\ncat .flow/results.xml > /dev/null\n",
};
