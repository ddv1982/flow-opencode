import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { DecisionProvider } from "../src/application/ports/decision-provider.js";
import * as jev from "../src/infrastructure/jev-decision-provider.js";
import FlowPlugin from "../src/platform/opencode/plugin.js";
import { resolveTypesafeApiKeyReader } from "../src/platform/opencode/typesafe-key-env.js";
import {
	createNativeFlowHost,
	nativeText,
} from "./fixtures/native-flow-host.js";

const warning =
	"Flow plugin option typesafeApiKeyEnv must be a portable environment variable name; Typesafe advice is disabled.";
const fixtureSchema = z.object({
	pluginOptions: z.record(z.string(), z.unknown()),
	args: z.string(),
});

async function pluginFixture() {
	const root = process.env.XDG_STATE_HOME;
	if (!root) throw new Error("Missing isolated fixture directory.");
	const options = fixtureSchema.parse(JSON.parse(process.argv[3] ?? "null"));
	const native = await createNativeFlowHost(root, options.pluginOptions);
	const providers: DecisionProvider[] = [];
	const factory = jev.createJevDecisionProvider;
	const providerSpy = spyOn(
		jev,
		"createJevDecisionProvider",
	).mockImplementation((readApiKey) => {
		const provider = factory(readApiKey);
		providers.push(provider);
		return provider;
	});
	const requests: Array<{ authorization: string | null; body: string }> = [];
	const transport = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (
				_url: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				requests.push({
					authorization: new Headers(init?.headers).get("Authorization"),
					body: String(init?.body),
				});
				return Response.json({
					model: "jev-1.13.0",
					answers: {
						choice: {
							type: "choice",
							choice: "repair",
							probabilities: { repair: 1, abstain: 0 },
							confidence: 1,
						},
						goal_0: { type: "noul", noul: 1 },
						fit_0: { type: "noul", noul: 1 },
					},
					usage: { input_tokens: 10, output_tokens: 5 },
				});
			},
			{ preconnect() {} },
		),
	);
	try {
		await native.load(FlowPlugin);
		await native.command("flow-auto", options.args);
		const input = { request: { view: "compact" } };
		const status = await native.invoke(
			"flow_status",
			input,
			await native.toolContext("flow_status", input),
		);
		const provider = providers[0];
		if (providers.length !== 1 || !provider)
			throw new Error("Expected the production plugin's decision provider.");
		const requestsBeforeAssessment = requests.length;
		const advice = await provider.assess(
			{
				sessionId: "fixture",
				revision: 3,
				sourceDigest: "sha256:abc",
				goal: "Fix parser",
				planDigest: "abc",
				rubric: "recovery-v1",
				findings: [{ id: "f", summary: "Null input", evidence: "parser.ts" }],
				candidates: [
					{
						id: "repair",
						action: "retry",
						featureId: "parser",
						remedy: "Guard null",
						changedFromPreviousAttempt: "Check before coercion",
						findingIds: ["f"],
					},
				],
			},
			{ signal: new AbortController().signal, reserveAttempt: () => true },
		);
		console.log(
			JSON.stringify({
				status: JSON.parse(nativeText(status)),
				advice,
				requests,
				requestsBeforeAssessment,
			}),
		);
	} finally {
		await native.dispose();
		providerSpy.mockRestore();
		transport.mockRestore();
	}
}

if (process.argv[2] === "--plugin-fixture") {
	await pluginFixture();
} else {
	test.each([
		{
			name: "default",
			pluginOptions: {},
			env: { TYPESAFE_API_KEY: "synthetic-default" },
			expected: "synthetic-default",
		},
		{ name: "default absent", pluginOptions: {}, env: {}, expected: undefined },
		{
			name: "custom only",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			env: { MY_TYPESAFE_KEY: "synthetic-custom" },
			expected: "synthetic-custom",
		},
		{
			name: "custom overrides default",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			env: {
				TYPESAFE_API_KEY: "synthetic-wrong",
				MY_TYPESAFE_KEY: "synthetic-custom",
			},
			expected: "synthetic-custom",
		},
		{
			name: "custom absent with default populated",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			env: { TYPESAFE_API_KEY: "synthetic-wrong" },
			expected: undefined,
		},
		{
			name: "custom empty with default populated",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			env: { TYPESAFE_API_KEY: "synthetic-wrong", MY_TYPESAFE_KEY: "" },
			expected: undefined,
		},
		{
			name: "custom whitespace with default populated",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			env: { TYPESAFE_API_KEY: "synthetic-wrong", MY_TYPESAFE_KEY: " \t\n " },
			expected: undefined,
		},
		{
			name: "default empty",
			pluginOptions: {},
			env: { TYPESAFE_API_KEY: "" },
			expected: undefined,
		},
		{
			name: "default whitespace",
			pluginOptions: {},
			env: { TYPESAFE_API_KEY: " \t\n " },
			expected: undefined,
		},
		{
			name: "trimmed custom",
			pluginOptions: { typesafeApiKeyEnv: "_my_key2" },
			env: { _my_key2: "  synthetic-custom \t" },
			expected: "synthetic-custom",
		},
	])("credential selector $name", ({ pluginOptions, env, expected }) => {
		const warnings: string[] = [];
		const read = resolveTypesafeApiKeyReader({
			pluginOptions,
			env,
			onWarning: (message) => warnings.push(message),
		});
		expect(read()).toBe(expected);
		expect(warnings).toEqual([]);
	});

	test.each(
		[
			"",
			" ",
			" MY_KEY",
			"MY_KEY ",
			"MY-KEY",
			"MY.KEY",
			"1KEY",
			"MY_KEY\n",
			"MY_KEY\r",
			"MY_KEY\0",
			"KÉY",
			null,
			42,
			{},
			[],
		].map((typesafeApiKeyEnv) => ({ typesafeApiKeyEnv })),
	)(
		"invalid credential variable name $typesafeApiKeyEnv disables selection without echoing input",
		({ typesafeApiKeyEnv }) => {
			const warnings: string[] = [];
			const read = resolveTypesafeApiKeyReader({
				pluginOptions: { typesafeApiKeyEnv },
				env: { TYPESAFE_API_KEY: "synthetic-wrong" },
				onWarning: (message) => warnings.push(message),
			});
			expect(read()).toBeUndefined();
			expect(warnings).toEqual([warning]);
		},
	);

	test("reader fixes the selected name and reads only its current value", () => {
		const pluginOptions = { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" };
		const env = {
			MY_TYPESAFE_KEY: "synthetic-first",
			get TYPESAFE_API_KEY(): string {
				throw new Error("Default must not be read.");
			},
		};
		const read = resolveTypesafeApiKeyReader({ pluginOptions, env });
		expect(read()).toBe("synthetic-first");
		pluginOptions.typesafeApiKeyEnv = "TYPESAFE_API_KEY";
		env.MY_TYPESAFE_KEY = "synthetic-second";
		expect(read()).toBe("synthetic-second");
	});
	test.each(["constructor", "toString", "__proto__"])(
		"portable name %s reads only an own environment entry",
		(typesafeApiKeyEnv) => {
			const pluginOptions = { typesafeApiKeyEnv };
			expect(
				resolveTypesafeApiKeyReader({ pluginOptions, env: {} })(),
			).toBeUndefined();
			expect(
				resolveTypesafeApiKeyReader({
					pluginOptions,
					env: Object.fromEntries([[typesafeApiKeyEnv, "synthetic-own-value"]]),
				})(),
			).toBe("synthetic-own-value");
		},
	);

	for (const scenario of [
		{
			name: "default",
			pluginOptions: {},
			keys: { TYPESAFE_API_KEY: "synthetic-default" },
			mode: "shadow",
			authorization: "Bearer synthetic-default",
		},
		{
			name: "custom only",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			keys: { MY_TYPESAFE_KEY: "synthetic-custom" },
			mode: "shadow",
			authorization: "Bearer synthetic-custom",
		},
		{
			name: "custom overrides default",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			keys: {
				TYPESAFE_API_KEY: "synthetic-wrong",
				MY_TYPESAFE_KEY: "synthetic-custom",
			},
			mode: "shadow",
			authorization: "Bearer synthetic-custom",
		},
		{
			name: "custom missing",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			keys: { TYPESAFE_API_KEY: "synthetic-wrong" },
			mode: "off",
		},
		{
			name: "custom blank",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			keys: { TYPESAFE_API_KEY: "synthetic-wrong", MY_TYPESAFE_KEY: " \t " },
			mode: "off",
		},
		{
			name: "invalid name",
			pluginOptions: { typesafeApiKeyEnv: "bad-private-input" },
			keys: { TYPESAFE_API_KEY: "synthetic-wrong" },
			mode: "off",
			warning: true,
		},
		{
			name: "explicit command off",
			pluginOptions: { typesafeApiKeyEnv: "MY_TYPESAFE_KEY" },
			keys: { MY_TYPESAFE_KEY: "synthetic-custom" },
			args: "--recovery=off",
			mode: "off",
			authorization: "Bearer synthetic-custom",
		},
		{
			name: "internal plugin off",
			pluginOptions: {
				typesafeApiKeyEnv: "MY_TYPESAFE_KEY",
				recovery: { mode: "off" },
			},
			keys: {
				TYPESAFE_API_KEY: "synthetic-wrong",
				MY_TYPESAFE_KEY: "synthetic-custom",
			},
			mode: "off",
		},
	]) {
		test(`production plugin setup ${scenario.name}`, async () => {
			const root = await mkdtemp(join(tmpdir(), "flow-typesafe-env-"));
			let child: ReturnType<typeof Bun.spawn> | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const fixture = Bun.spawn(
					[
						process.execPath,
						import.meta.path,
						"--plugin-fixture",
						JSON.stringify({
							pluginOptions: scenario.pluginOptions,
							args: scenario.args ?? "",
						}),
					],
					{
						env: {
							PATH: "/usr/bin:/bin",
							XDG_STATE_HOME: root,
							...scenario.keys,
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				child = fixture;
				timer = setTimeout(() => child?.kill("SIGKILL"), 10000);
				const [stdout, stderr, exitCode] = await Promise.all([
					new Response(fixture.stdout).text(),
					new Response(fixture.stderr).text(),
					fixture.exited,
				]);
				expect({ exitCode, stderr: stderr.includes("error") }).toEqual({
					exitCode: 0,
					stderr: false,
				});
				const result = JSON.parse(stdout);
				expect(result.requestsBeforeAssessment).toBe(0);
				expect(result.status.status).toBe("ok");
				expect(result.status.workflowData.recoveryStatus.mode).toBe(
					scenario.mode,
				);
				if (scenario.mode === "shadow")
					expect(result.status.workflowData.recoveryStatus).toMatchObject({
						remainingCalls: 6,
						maxUsd: 0.02,
					});
				if (scenario.authorization) {
					expect(result.advice).toMatchObject({
						kind: "answered",
						model: "jev-1.13.0",
						choice: "repair",
					});
					expect(result.requests).toHaveLength(1);
					expect(result.requests[0].authorization).toBe(scenario.authorization);
					expect(result.requests[0].body).not.toContain("synthetic-");
				} else {
					expect(result.advice).toMatchObject({
						kind: "unavailable",
						reason: "missing-key",
					});
					expect(result.requests).toEqual([]);
				}
				expect(JSON.stringify(result.status)).not.toContain("synthetic-");
				expect(stderr).not.toContain("synthetic-");
				expect(stderr).not.toContain("bad-private-input");
				expect(stderr.includes(warning)).toBe(scenario.warning ?? false);
			} finally {
				if (timer) clearTimeout(timer);
				if (child && child.exitCode === null) {
					child.kill("SIGKILL");
					await child.exited;
				}
				await rm(root, { recursive: true, force: true });
			}
		}, 15000);
	}
}
