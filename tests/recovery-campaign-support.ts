import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileSourceIdentityProvider } from "../src/infrastructure/fs/source-identity.js";
import {
	approveSession,
	deterministicEnvironment,
	MemorySessionRepository,
	plan,
	resetFeatureRun,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

const PARSER_FEATURE = "parser";
const campaignPlan = {
	...plan,
	summary: "Repair parser null handling and write the selected result.",
	overview:
		"Keep the parser within its approved behavior and review the output.",
	requirements: [
		"Handle null input without changing non-null parsing.",
		"Write the operator-selected result after recovery.",
	],
	decisions: ["Keep the parser API stable and require final review."],
	features: [
		{
			id: PARSER_FEATURE,
			title: "Parser recovery",
			summary: "Repair the parser and write the operator-selected result.",
			targets: ["parser.ts", "result.txt"],
			validation: ["bun test"],
			dependsOn: [],
		},
	],
};

export async function frozenCampaignFixture() {
	const files: Record<string, string> = {
		".gitignore": "/opencode.json\n/.opencode/\n",
		"parser.ts": "export const parse = (value: string) => value.trim();\n",
		"result.txt": "broken\n",
	};
	const root = await mkdtemp(join(tmpdir(), "campaign-fixture-"));
	try {
		for (const [path, content] of Object.entries(files))
			await writeFile(join(root, path), content);
		for (const args of [
			["init", "--initial-branch=main"],
			["add", "."],
		]) {
			const child = Bun.spawnSync(["git", "-C", root, ...args], {
				env: {
					PATH: process.env.PATH,
					HOME: root,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			if (child.exitCode !== 0) throw new Error(child.stderr.toString());
		}
		const repository = new MemorySessionRepository();
		repository.sourceDigest =
			await createFileSourceIdentityProvider(root).computeSourceDigest();
		const flow = await approveSession(repository, deterministicEnvironment(), {
			goal: "Repair parser null handling and write the selected output after recovery.",
			plan: campaignPlan,
		});
		for (let i = 0; i < 2; i++) {
			if (i)
				await resetFeatureRun(flow, repository, PARSER_FEATURE, `reset-${i}`);
			await startReviewedRun(flow, repository, {
				featureId: PARSER_FEATURE,
				suffix: `failed-${i}`,
			});
			await submitReview(flow, repository, {
				featureId: PARSER_FEATURE,
				suffix: `failed-${i}`,
				summary: "Missing null guard",
				verdict: "failed",
				findings: [
					{
						severity: "blocking",
						summary: "Null input crashes",
						evidence: "parser.ts",
						...(i
							? {
									findingId:
										repository.session?.runs[0]?.reviews[0]?.result?.findings[0]
											?.findingId,
								}
							: {}),
					},
				],
			});
		}
		if (!repository.session) throw new Error("Missing fixture session.");
		files[".flow/session.json"] = JSON.stringify(repository.session);
		return {
			sourceDigest: repository.sourceDigest,
			session: repository.session,
			fixture: {
				task: {
					instruction:
						"Repair the blocked parser within its approved plan, then ask the operator which output to write and follow their answer.",
				},
				files,
				generatedDirectories: [".flow"],
				completion: {
					criteria:
						"The parser handles null input and the exact operator selected output is written after recovery.",
					files: {
						"parser.ts":
							'export const parse = (value: string | null) => value?.trim() ?? "";\n',
						"result.txt": "fixed\n",
					},
				},
			},
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
