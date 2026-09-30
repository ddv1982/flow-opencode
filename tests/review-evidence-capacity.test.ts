import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

test.skipIf(process.platform === "win32")(
	"aggregate capacity stops generating moderate diffs before the remaining files",
	async () => {
		const scratch = await mkdtemp(join(tmpdir(), "flow-evidence-budget-"));
		const project = join(scratch, "project");
		const commands = join(scratch, "commands");
		const counter = join(scratch, "diff-calls");
		const realGit = Bun.which("git");
		if (!realGit) throw new Error("Git is required for the evidence fixture.");
		try {
			await mkdir(project);
			await mkdir(commands);
			await writeFile(counter, "");
			await writeFile(
				join(commands, "git"),
				`#!/bin/sh\nfor arg do\n if [ "$arg" = "--no-index" ]; then printf 'diff\\n' >> ${quote(counter)}; break; fi\ndone\nexec ${quote(realGit)} "$@"\n`,
				{ mode: 0o755 },
			);
			const providerPath = new URL(
				"../src/infrastructure/fs/review-evidence.ts",
				import.meta.url,
			).pathname;
			const identityPath = new URL(
				"../src/infrastructure/fs/source-identity.ts",
				import.meta.url,
			).pathname;
			const script = join(scratch, "prepare.ts");
			await writeFile(
				script,
				`import {writeFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {createFileReviewEvidenceProvider} from ${JSON.stringify(providerPath)};
import {createFileSourceIdentityProvider} from ${JSON.stringify(identityPath)};
const project=${JSON.stringify(project)};
async function git(args:string[]) {
 const child=Bun.spawn(["git","-C",project,...args],{stdout:"ignore",stderr:"pipe"});
 if(await child.exited)throw new Error(await new Response(child.stderr).text());
}
for(let index=0;index<40;index++)await writeFile(join(project,"file-"+index+".txt"),"before line\\n".repeat(7000));
for(const args of [["init","--quiet"],["config","user.name","Fixture"],["config","user.email","fixture@example.invalid"],["add","."],["commit","--quiet","-m","baseline"]])await git(args);
const provider=createFileReviewEvidenceProvider(project);
const identity=createFileSourceIdentityProvider(project);
const baseline=await provider.captureBaseline({sessionId:"session",featureId:"feature",originRunId:"run",sourceDigest:await identity.computeSourceDigest()});
const before=(await readdir(join(project,".flow/evidence"))).sort();
for(let index=0;index<40;index++)await writeFile(join(project,"file-"+index+".txt"),"after! line\\n".repeat(7000));
let message="";
try{await provider.prepare({sessionId:"session",featureId:"feature",runId:"run",baseline,sourceDigest:await identity.computeSourceDigest(),declaredArtifacts:[],authorizedTargets:[]});}
catch(error){if(!(error instanceof Error))throw error;message=error.message;}
console.log(JSON.stringify({message,before,after:(await readdir(join(project,".flow/evidence"))).sort()}));`,
			);
			const child = Bun.spawn([process.execPath, script], {
				env: {
					...process.env,
					PATH: `${commands}:${process.env.PATH ?? ""}`,
					TYPESAFE_API_KEY: "",
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(code, stderr).toBe(0);
			const result = JSON.parse(stdout);
			expect(result.message).toContain("aggregate capacity");
			expect(result.after).toEqual(result.before);
			const invocations = (await readFile(counter, "utf8"))
				.trim()
				.split("\n").length;
			expect(invocations).toBeGreaterThan(0);
			expect(invocations).toBeLessThan(40);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	},
);
