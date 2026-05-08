import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..", "..");
const distPath = join(projectRoot, "dist", "index.js");
const sourcemapPath = join(projectRoot, "dist", "index.js.map");
const bundleText = readFileSync(distPath, "utf8");
const sourcemap = JSON.parse(readFileSync(sourcemapPath, "utf8"));
const tempRoot = mkdtempSync(join(tmpdir(), "flow-bundle-sanity-"));
const BUNDLE_SIZE_BUDGET_BYTES = 741376; // 724 KiB

function cleanup() {
	rmSync(tempRoot, { recursive: true, force: true });
}

async function main() {
	try {
		const packageDir = join(tempRoot, "package");
		const worktree = join(tempRoot, "worktree");
		mkdirSync(packageDir, { recursive: true });
		mkdirSync(worktree, { recursive: true });

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

		const packageDistPath = join(packageDir, "index.js");
		const packageSourcemapPath = join(packageDir, "index.js.map");
		copyFileSync(distPath, packageDistPath);
		copyFileSync(sourcemapPath, packageSourcemapPath);

		const pluginModule = await import(`file://${packageDistPath}`);
		const plugin = await pluginModule.default({ worktree });
		const config = { agent: {}, command: {} };
		await plugin.config(config);

		const toolResults = {
			planStart: JSON.parse(
				await plugin.tool.flow_plan_start.execute(
					{ goal: "Bundle sanity" },
					{ worktree },
				),
			),
			status: JSON.parse(await plugin.tool.flow_status.execute({}, { worktree })),
			history: JSON.parse(await plugin.tool.flow_history.execute({}, { worktree })),
		};

		if (toolResults.planStart.status !== "ok") {
			throw new Error("flow_plan_start failed in bundle sanity smoke.");
		}
		if (toolResults.status.status !== "planning") {
			throw new Error("flow_status did not report the expected planning status.");
		}
		if (toolResults.status.session?.goal !== "Bundle sanity") {
			throw new Error("flow_status did not expose the expected session goal.");
		}
		const historyEntries = [
			toolResults.history.history?.active,
			...(toolResults.history.history?.stored ?? []),
			...(toolResults.history.history?.completed ?? []),
		].filter(Boolean);
		if (
			!historyEntries.some((entry) => entry.goal === "Bundle sanity")
		) {
			throw new Error("flow_history did not report the stored session.");
		}
		if (plugin.tool.flow_status.__mockTag !== "flow-bundle-sanity-mock-v1") {
			throw new Error("Bundle did not resolve @opencode-ai/plugin from the injected mock.");
		}

		const report = {
			sizeBytes: statSync(distPath).size,
			hasExternalPeerImport: bundleText.includes("@opencode-ai/plugin"),
			inlinesCreateOpencodeClient: bundleText.includes("createOpencodeClient"),
			sourceMapVersion: sourcemap.version,
			sourceMapHasMappings: typeof sourcemap.mappings === "string",
			sourceCount: Array.isArray(sourcemap.sources) ? sourcemap.sources.length : 0,
			configAgents: Object.keys(config.agent).length,
			configCommands: Object.keys(config.command).length,
			toolCount: Object.keys(plugin.tool).length,
			nodeMajor: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10),
			mockTagVerified:
				plugin.tool.flow_status.__mockTag === "flow-bundle-sanity-mock-v1",
		};

		if (report.sizeBytes > BUNDLE_SIZE_BUDGET_BYTES) {
			throw new Error(`Bundle too large: ${report.sizeBytes} bytes`);
		}
		if (!report.hasExternalPeerImport) {
			throw new Error("Bundle does not preserve the @opencode-ai/plugin reference.");
		}
		if (report.inlinesCreateOpencodeClient) {
			throw new Error("Bundle appears to inline peer dependency symbols.");
		}
		if (report.sourceMapVersion !== 3 || !report.sourceMapHasMappings) {
			throw new Error("Source map is not valid v3 JSON with mappings.");
		}
		if (
			report.configAgents !== 6 ||
			report.configCommands !== 9 ||
			report.toolCount !== 18
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
			throw new Error(`Node major version ${report.nodeMajor} is below the required 22.`);
		}

		console.log(JSON.stringify(report, null, 2));
	} finally {
		cleanup();
	}
}

await main();
