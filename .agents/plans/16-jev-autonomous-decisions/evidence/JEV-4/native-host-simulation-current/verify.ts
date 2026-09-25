import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	cwd: fileURLToPath(new URL(".", import.meta.url)),
	encoding: "utf8",
}).trim();
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repositoryRoot, encoding: "buffer" });
const read = (name: string) => readFile(new URL(name, import.meta.url));
const sha = (value: Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
const assert = (condition: unknown, reason: string) => {
	if (!condition) throw new Error(`Host simulation receipt invalid: ${reason}`);
};
const { datasetDigest } = await import(
	pathToFileURL(join(repositoryRoot, "evals/recovery-decisions/schema.ts")).href
);
const { HostArtifactsSchema } = await import(
	pathToFileURL(join(repositoryRoot, "evals/host-artifacts.ts")).href
);
const receipt = JSON.parse(await read("receipt.json"));
assert(/^[a-f0-9]{40}$/.test(receipt.sourceHead), "source commit");
assert(
	git("rev-parse", `${receipt.sourceHead}^{tree}`).toString("utf8").trim() ===
		receipt.sourceTreeOid,
	"source tree",
);
assert(
	spawnSync(
		"git",
		[
			"diff",
			"--quiet",
			receipt.sourceHead,
			"HEAD",
			"--",
			"src",
			"skills",
			"evals",
			"scripts",
			"tests",
			"package.json",
			"bun.lock",
			"tsconfig.json",
			"tsconfig.types.json",
		],
		{ cwd: repositoryRoot },
	).status === 0,
	"current runtime differs from measured head",
);
for (const [path, key] of [
	["tests/recovery-treatment-host.test.ts", "testFileSha256"],
	["evals/harness.ts", "testHelperSha256"],
	["bun.lock", "lockSha256"],
] as const)
	assert(
		sha(git("show", `${receipt.sourceHead}:${path}`)) === receipt[key],
		`${path} digest`,
	);
const logBytes = await read("smoke.log");
assert(sha(logBytes) === receipt.logSha256, "log digest");
const log = logBytes.toString("utf8");
const cases = log
	.split("\n")
	.filter((line) => line.startsWith("(pass) "))
	.map((line) => line.slice(7).replace(/ \[[^\]]+\]$/, ""));
assert(
	cases.length === 10 &&
		receipt.passed === 10 &&
		receipt.failed === 0 &&
		log.includes(" 10 pass") &&
		log.includes(" 0 fail") &&
		JSON.stringify(cases) === JSON.stringify(receipt.scenarios),
	"ten retained host simulation results",
);
assert(
	cases.some((name) => name.includes("openai/gpt-5.6-terra")) &&
		cases.some((name) => name.includes("xai/grok-4.6")) &&
		cases.filter((name) => name.includes("stop revokes delayed")).length === 2,
	"both manager routes and delayed stop",
);
const capturedFiles = (
	await readdir(new URL("host-artifacts/", import.meta.url))
).sort();
const loggedArtifacts = log
	.split("\n")
	.filter((line) => line.startsWith("host-artifact "))
	.map((line) => line.slice("host-artifact ".length).trim());
assert(
	receipt.hostArtifactCaptures?.length === 10 &&
		loggedArtifacts.length === 10 &&
		JSON.stringify(capturedFiles) ===
			JSON.stringify(
				receipt.hostArtifactCaptures
					.map((row: { file: string }) => row.file)
					.sort(),
			) &&
		receipt.trustedExecutableVersion === "1.18.31" &&
		/^[a-f0-9]{64}$/.test(receipt.trustedExecutableSha256),
	"complete pinned treatment host captures",
);
for (const [index, record] of receipt.hostArtifactCaptures.entries()) {
	const caseName = cases[index];
	const model = caseName.match(
		/(?:real|native) (openai\/gpt-5\.6-terra|xai\/grok-4\.6) /,
	)?.[1];
	const scenario = caseName.includes("stop revokes delayed")
		? "delayed-stop"
		: caseName.match(
				/simulation (accepted|control|subthreshold|model-mismatch)$/,
			)?.[1];
	assert(model && scenario, `case ${index + 1} identifier`);
	const file = `${model.replaceAll("/", "-")}-${scenario}.json`;
	assert(record.file === file, `case ${index + 1} file`);
	const bytes = await read(`host-artifacts/${file}`);
	assert(sha(bytes) === record.sha256, `${file} digest`);
	assert(
		loggedArtifacts[index] === `${file} ${record.sha256}`,
		`${file} logged capture digest`,
	);
	const capture = JSON.parse(bytes.toString("utf8"));
	const artifacts = HostArtifactsSchema.parse(capture.identity);
	assert(
		capture.schemaVersion === 1 &&
			capture.caseId === file.slice(0, -5) &&
			capture.verification.manifestDigest === datasetDigest(artifacts) &&
			capture.verification.method === "copied-files-and-linux-process" &&
			artifacts.opencode.version === receipt.trustedExecutableVersion &&
			artifacts.opencode.bytes.sha256 === receipt.trustedExecutableSha256 &&
			artifacts.opencode.bytes.executable === true &&
			artifacts.packageCache === null,
		`${file} executable identity`,
	);
}
const executable = process.env.FLOW_RECOVERY_OPENCODE_EXECUTABLE;
let localBinaryVerified = false;
if (executable) {
	const path = await realpath(executable);
	const version = spawnSync(path, ["--version"], { encoding: "utf8" });
	assert(
		sha(await readFile(path)) === receipt.trustedExecutableSha256 &&
			version.status === 0 &&
			version.stdout.trim() === receipt.trustedExecutableVersion,
		"local pinned executable differs",
	);
	localBinaryVerified = true;
}
assert(
	sha(await read("verify.ts")) === receipt.verifySha256,
	"verifier digest",
);
process.stdout.write(
	`${JSON.stringify({ verdict: localBinaryVerified ? "verified-pinned-host-simulation" : "verified-captured-host-identity", head: receipt.sourceHead, cases: cases.length, opencodeSha256: receipt.trustedExecutableSha256 })}\n`,
);
