import { createRequire } from "node:module";

export function resolveFlowPluginVersion(): string {
	try {
		const require = createRequire(import.meta.url);
		const manifest = require("../package.json") as { version?: string };
		if (manifest.version) return manifest.version;
	} catch {
		// Fall through to the development sentinel.
	}
	return "0.0.0";
}
