import {
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The packed plugin schedules a best-effort npm update check at startup;
// keep the smoke deterministic and network-free.
process.env.FLOW_DISABLE_UPDATE_CHECK = "1";

const projectRoot = resolve(import.meta.dirname, "..", "..");
const distPath = join(projectRoot, "dist", "index.js");
const sourcemapPath = join(projectRoot, "dist", "index.js.map");
const bundleText = readFileSync(distPath, "utf8");
const sourcemap = JSON.parse(readFileSync(sourcemapPath, "utf8"));
const tempRoot = mkdtempSync(join(tmpdir(), "flow-bundle-sanity-"));
// The bundle carries only Flow source: zod and @opencode-ai/plugin are
// external (npm-resolved). The generated prompt surfaces are gone after the
// skills-first overhaul; what remains is the runtime plus the embedded skill
// documents (synced at startup), which lands around 150-160 KB. Hold the
// line at 200 KB to leave headroom for skill content growth without letting
// prompt-surface regressions sneak back in.
const BUNDLE_SIZE_BUDGET_BYTES = 204800; // 200 KiB

// The seven canonical tools are the whole registered surface as of v3.1.
const CANONICAL_TOOL_NAMES = [
	"flow_status",
	"flow_plan_save",
	"flow_plan_approve",
	"flow_run_start",
	"flow_feature_complete",
	"flow_review_record",
	"flow_session",
];

function cleanup() {
	rmSync(tempRoot, { recursive: true, force: true });
}

async function main() {
	try {
		const packageDir = join(tempRoot, "package");
		const worktree = join(tempRoot, "worktree");
		const hiddenWorktree = join(tempRoot, ".hidden-worktree");
		mkdirSync(packageDir, { recursive: true });
		mkdirSync(worktree, { recursive: true });
		mkdirSync(hiddenWorktree, { recursive: true });

		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ type: "module" }, null, 2),
		);

		const peerDir = join(packageDir, "node_modules", "@opencode-ai", "plugin");
		mkdirSync(peerDir, { recursive: true });
		writeFileSync(
			join(peerDir, "package.json"),
			JSON.stringify(
				{
					name: "@opencode-ai/plugin",
					version: "0.0.0-test",
					type: "module",
					exports: "./index.js",
				},
				null,
				2,
			),
		);
		writeFileSync(
			join(peerDir, "index.js"),
			[
				"import { createRequire } from 'node:module';",
				`const require = createRequire(${JSON.stringify(join(projectRoot, "package.json"))});`,
				"const zodModule = require('zod');",
				"const z = zodModule.z ?? zodModule;",
				"const MOCK_TAG = 'flow-bundle-sanity-mock-v1';",
				"export function tool(definition) {",
				"  return { ...definition, __mockTag: MOCK_TAG };",
				"}",
				"tool.schema = z;",
			].join("\n"),
		);

		// zod is an external runtime dependency of the bundle (resolved from the
		// npm package's own dependencies in production); vendor it next to the
		// copied bundle so the import resolves in this sandbox.
		cpSync(
			join(projectRoot, "node_modules", "zod"),
			join(packageDir, "node_modules", "zod"),
			{ recursive: true, dereference: true },
		);

		const packageDistPath = join(packageDir, "index.js");
		const packageSourcemapPath = join(packageDir, "index.js.map");
		copyFileSync(distPath, packageDistPath);
		copyFileSync(sourcemapPath, packageSourcemapPath);

		const pluginModule = await import(`file://${packageDistPath}`);
		const plugin = await pluginModule.default({ worktree });
		const config = { agent: {}, command: {} };
		await plugin.config(config);

		const toolResults = {
			planSave: JSON.parse(
				await plugin.tool.flow_plan_save.execute(
					{ goal: "Bundle sanity" },
					{ worktree },
				),
			),
			status: JSON.parse(
				await plugin.tool.flow_status.execute({}, { worktree }),
			),
			history: JSON.parse(
				await plugin.tool.flow_session.execute(
					{ action: "history" },
					{ worktree },
				),
			),
		};

		if (toolResults.planSave.status !== "ok") {
			throw new Error("flow_plan_save failed in bundle sanity smoke.");
		}
		if (toolResults.status.status !== "planning") {
			throw new Error(
				"flow_status did not report the expected planning status.",
			);
		}
		if (toolResults.status.session?.goal !== "Bundle sanity") {
			throw new Error("flow_status did not expose the expected session goal.");
		}
		const historyEntries = [
			toolResults.history.history?.active,
			...(toolResults.history.history?.stored ?? []),
			...(toolResults.history.history?.completed ?? []),
		].filter(Boolean);
		if (!historyEntries.some((entry) => entry.goal === "Bundle sanity")) {
			throw new Error(
				"flow_session history did not report the stored session.",
			);
		}
		if (plugin.tool.flow_status.__mockTag !== "flow-bundle-sanity-mock-v1") {
			throw new Error(
				"Bundle did not resolve @opencode-ai/plugin from the injected mock.",
			);
		}

		let permissionAskRuns = 0;
		const permissionSmoke = JSON.parse(
			await plugin.tool.flow_plan_save.execute(
				{ goal: "Bundle permission sanity" },
				{
					worktree: hiddenWorktree,
					ask: async () => {
						permissionAskRuns += 1;
					},
				},
			),
		);
		if (permissionSmoke.status !== "ok" || permissionAskRuns !== 1) {
			throw new Error(
				`Permission ask smoke failed: ${JSON.stringify({
					status: permissionSmoke.status,
					permissionAskRuns,
				})}`,
			);
		}

		const report = {
			sizeBytes: statSync(distPath).size,
			hasExternalPeerImport: bundleText.includes("@opencode-ai/plugin"),
			inlinesCreateOpencodeClient: bundleText.includes("createOpencodeClient"),
			sourceMapVersion: sourcemap.version,
			sourceMapHasMappings: typeof sourcemap.mappings === "string",
			sourceCount: Array.isArray(sourcemap.sources)
				? sourcemap.sources.length
				: 0,
			configAgents: Object.keys(config.agent).length,
			configCommands: Object.keys(config.command).length,
			toolCount: CANONICAL_TOOL_NAMES.filter((name) => name in plugin.tool)
				.length,
			extraToolCount: Object.keys(plugin.tool).filter(
				(name) => !CANONICAL_TOOL_NAMES.includes(name),
			).length,
			nodeMajor: Number.parseInt(
				process.versions.node.split(".")[0] ?? "0",
				10,
			),
			mockTagVerified:
				plugin.tool.flow_status.__mockTag === "flow-bundle-sanity-mock-v1",
			permissionAskRuns,
		};

		if (report.sizeBytes > BUNDLE_SIZE_BUDGET_BYTES) {
			throw new Error(`Bundle too large: ${report.sizeBytes} bytes`);
		}
		if (!report.hasExternalPeerImport) {
			throw new Error(
				"Bundle does not preserve the @opencode-ai/plugin reference.",
			);
		}
		if (report.inlinesCreateOpencodeClient) {
			throw new Error("Bundle appears to inline peer dependency symbols.");
		}
		if (report.sourceMapVersion !== 3 || !report.sourceMapHasMappings) {
			throw new Error("Source map is not valid v3 JSON with mappings.");
		}
		if (
			report.configAgents !== 1 ||
			report.configCommands !== 5 ||
			report.toolCount !== 7 ||
			report.extraToolCount !== 0
		) {
			throw new Error(
				`Plugin surface shape is incorrect after build: ${JSON.stringify({
					agents: report.configAgents,
					commands: report.configCommands,
					tools: report.toolCount,
				})}`,
			);
		}
		if (report.nodeMajor < 22) {
			throw new Error(
				`Node major version ${report.nodeMajor} is below the required 22.`,
			);
		}

		console.log(JSON.stringify(report, null, 2));
	} finally {
		cleanup();
	}
}

await main();
