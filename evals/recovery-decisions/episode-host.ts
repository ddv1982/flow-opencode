import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { EvalHost } from "../harness.js";
import {
	captureHostArtifacts,
	validateHostArtifactVerification,
	verifyHostArtifacts,
} from "../host-artifacts.js";
import {
	type OperatorPolicy,
	OperatorPolicySchema,
} from "./episode-operator.js";
import type { EpisodeDriver } from "./episode-runner.js";
import {
	type EpisodeReservationScope,
	EpisodeReservationScopeSchema,
	reconcileRequestReservations,
} from "./request-budget.js";
import { datasetDigest } from "./schema.js";
import { recoverySourceDigests } from "./sources.js";
import { validateTreatmentBudget } from "./treatment.js";

const FilePath = z
	.string()
	.min(1)
	.max(512)
	.refine(
		(path) =>
			!path.includes("\\") &&
			!path.includes(":") &&
			!path.includes("\0") &&
			path
				.split("/")
				.every((part) => part !== "" && part !== "." && part !== "..") &&
			![".git", ".opencode", "opencode.json"].includes(
				path.split("/")[0] ?? "",
			),
		"Fixture paths must be relative workload paths.",
	);
const Files = z
	.record(FilePath, z.string().max(1_000_000))
	.refine(
		(files) =>
			Object.keys(files).length > 0 && Object.keys(files).length <= 100,
		"Fixtures require one to 100 files.",
	);
export const EpisodeHostFixtureSchema = z
	.object({
		task: z
			.object({ instruction: z.string().trim().min(1).max(100000) })
			.strict(),
		files: Files,
		generatedDirectories: z
			.array(FilePath)
			.max(100)
			.default([])
			.refine(
				(paths) => new Set(paths).size === paths.length,
				"Duplicate generated directories.",
			),
		completion: z
			.object({ criteria: z.string().trim().min(1), files: Files })
			.strict(),
	})
	.strict();
const bytesDigest = (value: string | Buffer) =>
	createHash("sha256").update(value).digest("hex");
export function episodeHostIdentity(input: unknown) {
	const fixture = EpisodeHostFixtureSchema.parse(input);
	return {
		task: fixture.task,
		initialState: {
			files: Object.fromEntries(
				Object.entries(fixture.files).map(([path, content]) => [
					path,
					bytesDigest(content),
				]),
			),
		},
		completionCriteria: JSON.stringify({
			kind: "exact-files-v1",
			description: fixture.completion.criteria,
			filesDigest: datasetDigest(fixture.completion.files),
			generatedDirectories: [...fixture.generatedDirectories].sort(),
		}),
	};
}
type Host = Pick<
	EvalHost,
	| "artifactIdentity"
	| "artifactVerification"
	| "project"
	| "createSession"
	| "runCommand"
	| "runPrompt"
	| "escalationQuestion"
	| "stop"
>;
type StartOptions = Parameters<typeof EvalHost.start>[0];
export type EpisodeHostOptions = {
	fixture: unknown;
	operator?: OperatorPolicy;
	arm: "manager-only" | "manager-plus-jev";
	manager: { model: string; prompt: string };
	host: { opencodeExecutable: string } & Pick<
		StartOptions,
		| "toolchain"
		| "packageCache"
		| "packageVersion"
		| "opencodeVersion"
		| "requestBudget"
		| "providerCredentials"
		| "recoveryTreatment"
	>;
	hostFactory?: (options: StartOptions) => Promise<Host>;
};
async function workload(
	project: string,
	allowed: ReadonlySet<string>,
	signal: AbortSignal,
	generatedDirectories: readonly string[] = [],
) {
	signal.throwIfAborted();
	const root = await lstat(project);
	if (root.isSymbolicLink() || !root.isDirectory())
		throw new Error("Unsafe fixture root.");
	const result: Record<string, string> = {};
	const visit = async (relative: string) => {
		for (const name of await readdir(join(project, relative))) {
			signal.throwIfAborted();
			const path = relative ? `${relative}/${name}` : name;
			const info = await lstat(join(project, path));
			if (info.isSymbolicLink())
				throw new Error("Fixture symlinks are forbidden.");
			if (!relative && [".git", ".opencode", "opencode.json"].includes(name))
				continue;
			if (info.isDirectory()) await visit(path);
			else if (info.isFile()) {
				if (
					(!allowed.has(path) &&
						!generatedDirectories.some((directory) =>
							path.startsWith(`${directory}/`),
						)) ||
					info.size > 1_000_000
				)
					throw new Error("Undeclared or oversized workload file.");
				result[path] = bytesDigest(await readFile(join(project, path)));
			} else throw new Error("Unsupported workload entry.");
		}
	};
	await visit("");
	return { files: result };
}
export async function createEpisodeHostDriver(
	options: EpisodeHostOptions,
): Promise<EpisodeDriver> {
	options = { ...options, host: structuredClone(options.host) };
	if (options.host.requestBudget)
		options.host.requestBudget.directory = resolve(
			options.host.requestBudget.directory,
		);
	if (options.arm === "manager-plus-jev" && !options.host.recoveryTreatment)
		throw new Error("Manager-plus-Jev requires isolated treatment.");
	if (
		options.host.recoveryTreatment &&
		options.host.recoveryTreatment.arm !== options.arm
	)
		throw new Error("Treatment arm differs from registered arm.");
	const operatorPolicy = Object.freeze(
		OperatorPolicySchema.parse(options.operator ?? { kind: "disabled" }),
	);
	const fixture = EpisodeHostFixtureSchema.parse(options.fixture);
	const manager = z
		.object({
			model: z.string().regex(/^[^\s/]+\/[^\s]+$/),
			prompt: z.string().trim().min(1),
		})
		.strict()
		.parse(options.manager);
	if (
		options.host.toolchain.actualVersion !==
		options.host.toolchain.expectedVersion
	)
		throw new Error("Unpinned Bun toolchain.");
	if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(options.host.opencodeVersion))
		throw new Error("OpenCode version must be exact.");
	if (
		options.host.requestBudget &&
		options.host.requestBudget.managerModel !== manager.model
	)
		throw new Error("Host budget manager differs from the registered manager.");
	const hostArtifacts = await captureHostArtifacts({
		paths: {
			bun: options.host.toolchain.executable,
			opencode: options.host.opencodeExecutable,
			packageCache: options.host.recoveryTreatment
				? null
				: options.host.packageCache,
		},
		bunVersion: options.host.toolchain.actualVersion,
		opencodeVersion: options.host.opencodeVersion,
	});
	const sources = await recoverySourceDigests();
	const evalSources = (await readdir("evals", { recursive: true }))
		.filter((path) => path.endsWith(".ts"))
		.sort();
	for (const path of evalSources)
		sources[`evals/${path}`] = bytesDigest(await readFile(join("evals", path)));
	const harnessDigest = datasetDigest({
		version: "episode-host-v2",
		hostArtifacts,
		operatorPolicy,
		requestAuthorizationDigest:
			options.host.requestBudget?.authorizationDigest ?? null,
		manager,
		recoveryTreatment: options.host.recoveryTreatment ?? null,
		providerCredentials: options.host.providerCredentials ?? "inherit",
		sources,
		host: {
			bun: options.host.toolchain.actualVersion,
			opencodeVersion: options.host.opencodeVersion,
			packageVersion: options.host.recoveryTreatment
				? null
				: (options.host.packageVersion ?? null),
			composition: options.host.recoveryTreatment
				? "experimental-source-bundle"
				: "packed-production",
			withFlow: true,
			ambientConfig: "disabled",
			reviewerEnvironment: "disabled",
			nativeLlm: false,
		},
	});
	const lifecycle = new AbortController();
	let host: Host | undefined;
	let starting: Promise<Host> | undefined;
	let state: "new" | "starting" | "prepared" | "running" | "ran" | "stopped" =
		"new";
	let stopping: Promise<void> | undefined;
	let stopped = false;
	let prepared = false;
	let reservationScope: EpisodeReservationScope | undefined;
	return {
		harnessDigest,
		get expectedHostArtifacts() {
			return structuredClone(hostArtifacts);
		},
		operatorPolicy,
		origin: options.host.recoveryTreatment?.origin ?? "live",
		...(options.host.recoveryTreatment?.origin === "live"
			? ({
					async admitLive(input, signal) {
						signal?.throwIfAborted();
						const scope = EpisodeReservationScopeSchema.parse(input.scope);
						const identity = episodeHostIdentity(fixture);
						if (
							state !== "new" ||
							scope.arm !== options.arm ||
							datasetDigest(input.manager) !== datasetDigest(manager) ||
							input.taskDigest !== datasetDigest(identity.task) ||
							input.initialStateDigest !==
								datasetDigest(identity.initialState) ||
							input.completionCriteria !== identity.completionCriteria
						)
							throw new Error(
								"Live episode differs from frozen host configuration.",
							);
						if (
							options.host.providerCredentials !== "inherit" &&
							options.host.providerCredentials !== "disabled"
						)
							throw new Error(
								"Live episode requires explicit provider credential policy.",
							);
						if (
							options.arm === "manager-plus-jev" &&
							!options.host.toolchain.environment.TYPESAFE_API_KEY?.trim()
						)
							throw new Error(
								"Live Jev episode requires a toolchain credential.",
							);
						const treatment = options.host.recoveryTreatment;
						if (!treatment) throw new Error("Live treatment unavailable.");
						const status = await validateTreatmentBudget(
							treatment,
							options.host.requestBudget
								? { ...options.host.requestBudget, scope }
								: undefined,
						);
						const requiredModels =
							options.arm === "manager-plus-jev"
								? [manager.model, "typesafe/jev-1.13.0"]
								: [manager.model];
						const requiredReservations = requiredModels.map((model) =>
							status.authorization.models.find((row) => row.model === model),
						);
						if (
							status.consumed + requiredModels.length >
								status.authorization.maxRequests ||
							requiredReservations.some((bound) => !bound) ||
							status.reservedMicroUsd +
								requiredReservations.reduce(
									(sum, bound) => sum + (bound?.reservationMicroUsd ?? 0),
									0,
								) >
									status.authorization.maxMicroUsd
						)
							throw new Error("Live episode request budget exhausted.");
						signal?.throwIfAborted();
					},
				} satisfies Pick<EpisodeDriver, "admitLive">)
			: {}),
		async prepare(signal, scopeInput) {
			if (state !== "new")
				throw new Error("An episode host can only prepare once.");
			signal.throwIfAborted();
			state = "starting";
			if (options.host.requestBudget) {
				reservationScope = Object.freeze(
					EpisodeReservationScopeSchema.parse(scopeInput),
				);
				if (reservationScope.arm !== options.arm)
					throw new Error("Reservation scope arm mismatch.");
			}
			await verifyHostArtifacts(
				{
					bun: options.host.toolchain.executable,
					opencode: options.host.opencodeExecutable,
					packageCache: options.host.recoveryTreatment
						? null
						: options.host.packageCache,
				},
				hostArtifacts,
				signal,
			);
			signal.throwIfAborted();
			lifecycle.signal.throwIfAborted();
			starting = (options.hostFactory ?? EvalHost.start)({
				...options.host,
				...(options.host.requestBudget && reservationScope
					? {
							requestBudget: {
								...options.host.requestBudget,
								scope: reservationScope,
							},
						}
					: {}),
				frozenArtifacts: {
					opencodeExecutable: options.host.opencodeExecutable,
					identity: structuredClone(hostArtifacts),
				},
				files: fixture.files,
				withFlow: true,
				ambientConfig: "disabled",
				reviewerEnvironment: "disabled",
				nativeLlm: false,
				signal: AbortSignal.any([signal, lifecycle.signal]),
			});
			host = await starting;
			if (lifecycle.signal.aborted || signal.aborted) {
				await host.stop();
				throw new Error("Episode host preparation cancelled.");
			}
			if (
				!host.artifactIdentity ||
				datasetDigest(host.artifactIdentity) !== datasetDigest(hostArtifacts)
			)
				throw new Error("Host did not attest registered artifact bytes.");
			const artifactVerification = host.artifactVerification;
			validateHostArtifactVerification(hostArtifacts, artifactVerification);
			const actual = await workload(
				host.project,
				new Set(Object.keys(fixture.files)),
				signal,
			);
			if (
				datasetDigest(actual) !==
				datasetDigest(episodeHostIdentity(fixture).initialState)
			)
				throw new Error("Seeded fixture differs from its definition.");
			lifecycle.signal.throwIfAborted();
			state = "prepared";
			prepared = true;
			return {
				task: fixture.task,
				initialState: actual,
				...(artifactVerification ? { artifactVerification } : {}),
			};
		},
		async run(context) {
			if (state !== "prepared" || !host)
				throw new Error("Episode host is not prepared.");
			context.signal.throwIfAborted();
			state = "running";
			const session = await host.createSession("Frozen recovery episode");
			let end = await host.runCommand(
				session,
				"flow-auto",
				`${options.arm === "manager-plus-jev" ? "--recovery=delegated --recovery-calls=3 --recovery-usd=0.01 " : ""}${manager.prompt}\n\n${fixture.task.instruction}`,
				manager.model,
			);
			context.signal.throwIfAborted();
			lifecycle.signal.throwIfAborted();
			while (end === "escalated") {
				const reply = await context.waitForOperator(
					host.escalationQuestion(session),
				);
				context.signal.throwIfAborted();
				lifecycle.signal.throwIfAborted();
				end = await host.runPrompt(session, reply, manager.model);
				context.signal.throwIfAborted();
				lifecycle.signal.throwIfAborted();
			}
			state = "ran";
		},
		async evaluate(criteria, signal) {
			if (state !== "ran" || !host)
				throw new Error("Episode host has not finished its prompt.");
			if (criteria !== episodeHostIdentity(fixture).completionCriteria)
				throw new Error("Completion criteria changed.");
			const actual = await workload(
				host.project,
				new Set([
					...Object.keys(fixture.files),
					...Object.keys(fixture.completion.files),
				]),
				signal,
				fixture.generatedDirectories,
			);
			const checks = Object.entries(fixture.completion.files).map(
				([path, contents]) => ({
					path,
					expectedDigest: bytesDigest(contents),
					actualDigest: actual.files[path] ?? null,
					met: actual.files[path] === bytesDigest(contents),
				}),
			);
			return {
				met: checks.every((check) => check.met),
				evidence: { kind: "exact-file-checks", checks },
			};
		},
		async reconcileReservations() {
			if (
				!stopped ||
				!prepared ||
				!options.host.requestBudget ||
				!reservationScope
			)
				throw new Error("Episode reservations are not complete.");
			return reconcileRequestReservations(
				options.host.requestBudget.directory,
				options.host.requestBudget.authorizationDigest,
				reservationScope,
			);
		},
		stop() {
			stopping ??= (async () => {
				lifecycle.abort();
				state = "stopped";
				const active = host ?? (await starting?.catch(() => undefined));
				if (active) await active.stop();
				stopped = true;
			})();
			return stopping;
		},
	};
}
