import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const manager of ["openai", "xai"]) {
	for (const scenario of [
		"accepted",
		"control",
		"transport-failure",
		"replaced-fetch",
		"replaced-websocket",
		"simulation",
		"expired",
		"cancelled",
		"missing-jev",
		"wrong-manager",
		"other-manager",
		"missing-key",
		"digest",
		"missing-scope",
		"unknown-option",
		"script",
		"failed-ready",
		"forged-ready",
		"pending-ready",
		"gate-fetch",
		"gate-websocket",
		"gate-scope",
		"treatment-ready",
	]) {
		test(`live entry ${scenario} for ${manager} with intercepted transport`, async () => {
			const root = await mkdtemp(join(tmpdir(), "live-treatment-test-"));
			let child: ReturnType<typeof Bun.spawn> | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				child = Bun.spawn(
					[
						process.execPath,
						"tests/recovery-live-treatment-child.ts",
						root,
						scenario,
						manager,
					],
					{
						env: {
							PATH: "/usr/bin:/bin",
							HOME: root,
							XDG_CONFIG_HOME: root,
							XDG_CACHE_HOME: root,
							XDG_DATA_HOME: root,
							GIT_CONFIG_NOSYSTEM: "1",
							GIT_CONFIG_GLOBAL: "/dev/null",
							TYPESAFE_API_KEY: "synthetic-live-key",
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				timer = setTimeout(() => child?.kill("SIGKILL"), 10000);
				const [stdout, stderr, exitCode] = await Promise.all([
					new Response(child.stdout as ReadableStream).text(),
					new Response(child.stderr as ReadableStream).text(),
					child.exited,
				]);
				expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
				expect(JSON.parse(stdout)).toMatchObject({ scenario, ok: true });
			} finally {
				clearTimeout(timer);
				child?.kill("SIGKILL");
				await child?.exited;
				await rm(root, { recursive: true, force: true });
			}
		}, 15000);
	}
}
