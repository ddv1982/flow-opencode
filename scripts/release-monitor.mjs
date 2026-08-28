#!/usr/bin/env node
// The only JavaScript source in the repository, and so the only source outside
// `tsc`. `release:monitor` runs it under plain `node` after publish, with no
// build step or Bun dependency, so it stays `.mjs` deliberately; Biome and
// tests/release-monitor.test.ts cover it instead.
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const JSON_FIELDS = [
	"attempt",
	"conclusion",
	"createdAt",
	"databaseId",
	"event",
	"headBranch",
	"headSha",
	"status",
	"updatedAt",
	"url",
	"workflowName",
].join(",");

const FAILURE_CONCLUSIONS = new Set([
	"action_required",
	"cancelled",
	"failure",
	"startup_failure",
	"stale",
	"timed_out",
]);

function usage() {
	return [
		"usage: node scripts/release-monitor.mjs [options]",
		"",
		"Monitors GitHub Actions runs for a release commit before declaring a release green.",
		"",
		"options:",
		"  --commit <sha>        Commit SHA to monitor (default: git rev-parse HEAD)",
		"  --tag <tag>           Release tag; defaults expected workflows to CI,Release",
		"  --expect <names>      Comma-separated workflow names to require",
		"  --repo <owner/repo>   GitHub repository passed to gh --repo",
		"  --timeout <seconds>   Maximum wait time (default: 900)",
		"  --command-timeout <seconds> Maximum one git or gh call may take (default: 30)",
		"  --interval <seconds>  Poll interval (default: 15)",
		"  --once                Check once and exit without polling",
		"  --json                Print final JSON summary",
		"  --help                Show this help",
	].join("\n");
}

function readFlag(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

function parseArgs(argv) {
	const options = {
		commit: null,
		tag: null,
		expect: null,
		repo: null,
		timeoutMs: 900_000,
		commandTimeoutMs: 30_000,
		intervalMs: 15_000,
		once: false,
		json: false,
		help: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--commit":
				options.commit = readFlag(argv, index, arg);
				index += 1;
				break;
			case "--tag":
				options.tag = readFlag(argv, index, arg);
				index += 1;
				break;
			case "--expect":
				options.expect = readFlag(argv, index, arg)
					.split(",")
					.map((name) => name.trim())
					.filter(Boolean);
				index += 1;
				break;
			case "--repo":
				options.repo = readFlag(argv, index, arg);
				index += 1;
				break;
			case "--timeout":
				options.timeoutMs = secondsToMs(readFlag(argv, index, arg), arg);
				index += 1;
				break;
			case "--interval":
				options.intervalMs = secondsToMs(readFlag(argv, index, arg), arg);
				index += 1;
				break;
			case "--command-timeout":
				options.commandTimeoutMs = secondsToMs(readFlag(argv, index, arg), arg);
				index += 1;
				break;
			case "--once":
				options.once = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}
	if (options.commandTimeoutMs > options.timeoutMs) {
		throw new Error("--command-timeout cannot exceed --timeout.");
	}
	return {
		...options,
		expectedWorkflows:
			options.expect ?? (options.tag ? ["CI", "Release"] : ["CI"]),
	};
}

function secondsToMs(value, flag) {
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		throw new Error(`${flag} must be a positive number of seconds.`);
	}
	return seconds * 1000;
}

function run(command, args, timeoutMs) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: timeoutMs,
	});
	if (result.error || result.status !== 0) {
		const errorDetail =
			result.error?.code === "ETIMEDOUT"
				? "timed out"
				: result.error?.message || result.stderr || result.stdout;
		throw new Error(`${command} ${args.join(" ")} failed: ${errorDetail}`);
	}
	return result.stdout.trim();
}

function resolveCommit(commit, commandTimeoutMs) {
	return commit ?? run("git", ["rev-parse", "HEAD"], commandTimeoutMs);
}

function workflowName(run) {
	return run.workflowName || run.name || "(unnamed workflow)";
}

function sortRuns(runs) {
	return [...runs].sort((left, right) =>
		String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
			String(left.updatedAt ?? left.createdAt ?? ""),
		),
	);
}

function latestByWorkflow(runs) {
	const grouped = new Map();
	for (const run of sortRuns(runs)) {
		const name = workflowName(run);
		if (!grouped.has(name)) grouped.set(name, run);
	}
	return grouped;
}

function listRuns(options) {
	if (process.env.FLOW_RELEASE_MONITOR_RUNS_JSON) {
		return JSON.parse(process.env.FLOW_RELEASE_MONITOR_RUNS_JSON);
	}
	const args = [
		"run",
		"list",
		"--commit",
		options.commit,
		"--limit",
		"100",
		"--json",
		JSON_FIELDS,
	];
	if (options.repo) args.push("--repo", options.repo);
	return JSON.parse(run("gh", args, options.commandTimeoutMs));
}

function evaluate(runs, options) {
	const runsForCommit = runs.filter((run) => run.headSha === options.commit);
	const byWorkflow = latestByWorkflow(runsForCommit);
	const required = options.expectedWorkflows.map((name) => ({
		name,
		run: byWorkflow.get(name) ?? null,
	}));
	const missing = required
		.filter((entry) => entry.run === null)
		.map((entry) => entry.name);
	const failed = [...byWorkflow.values()].filter(
		(run) =>
			run.status === "completed" && FAILURE_CONCLUSIONS.has(run.conclusion),
	);
	const pendingRequired = required
		.filter((entry) => entry.run?.status !== "completed")
		.map((entry) => entry.name);
	const unsuccessfulRequired = required.filter(
		(entry) =>
			entry.run?.status === "completed" && entry.run.conclusion !== "success",
	);
	const success =
		missing.length === 0 &&
		pendingRequired.length === 0 &&
		unsuccessfulRequired.length === 0 &&
		failed.length === 0;
	const failedRequired = unsuccessfulRequired.map((entry) => entry.run);
	return {
		success,
		commit: options.commit,
		tag: options.tag,
		expectedWorkflows: options.expectedWorkflows,
		missing,
		pendingRequired,
		failed: [...new Set([...failedRequired, ...failed])].filter(Boolean),
		runs: sortRuns(runsForCommit).map((run) => ({
			workflowName: workflowName(run),
			status: run.status,
			conclusion: run.conclusion,
			event: run.event,
			headBranch: run.headBranch,
			url: run.url,
		})),
	};
}

function formatSummary(summary) {
	const lines = [
		`commit: ${summary.commit}`,
		`expected: ${summary.expectedWorkflows.join(", ")}`,
	];
	if (summary.missing.length > 0) {
		lines.push(`missing: ${summary.missing.join(", ")}`);
	}
	if (summary.pendingRequired.length > 0) {
		lines.push(`pending: ${summary.pendingRequired.join(", ")}`);
	}
	for (const run of summary.runs) {
		lines.push(
			`- ${run.workflowName}: ${run.status}/${run.conclusion ?? "pending"} ${run.url ?? ""}`.trim(),
		);
	}
	return lines.join("\n");
}

function finish(summary, json) {
	if (json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	} else {
		process.stdout.write(`${formatSummary(summary)}\n`);
	}
	if (!summary.success) process.exitCode = 1;
}

async function main(argv) {
	const options = parseArgs(argv);
	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	options.commit = resolveCommit(options.commit, options.commandTimeoutMs);
	const started = Date.now();
	let lastSummary = null;
	while (Date.now() - started <= options.timeoutMs) {
		lastSummary = evaluate(listRuns(options), options);
		if (lastSummary.success || options.once || lastSummary.failed.length > 0) {
			finish(lastSummary, options.json);
			return;
		}
		if (!options.json) {
			process.stderr.write(`${formatSummary(lastSummary)}\n\n`);
		}
		const remainingMs = options.timeoutMs - (Date.now() - started);
		if (remainingMs <= 0) break;
		await delay(Math.min(options.intervalMs, remainingMs));
	}
	finish(lastSummary, options.json);
}

main(process.argv.slice(2)).catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 2;
});
