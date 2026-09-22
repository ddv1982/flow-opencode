import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const mode of ["credentials", "admission", "native"]) {
	const run =
		mode !== "native" || process.env.FLOW_RECOVERY_LIVE_HOST_SMOKE === "1"
			? test
			: test.skip;
	run(
		`isolated live host ${mode} without inference`,
		async () => {
			const requested =
				mode === "native"
					? process.env.FLOW_RECOVERY_LIVE_HOST_OUTPUT
					: undefined;
			const root =
				requested ?? (await mkdtemp(join(tmpdir(), "live-host-test-")));
			if (requested) await mkdir(root, { mode: 0o700 });
			let child: ReturnType<typeof Bun.spawn> | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				child = Bun.spawn(
					[
						process.execPath,
						"tests/recovery-live-host-child.ts",
						root,
						mode,
						process.env.FLOW_RECOVERY_OPENCODE_EXECUTABLE ?? "",
					],
					{
						env: {
							PATH: "/usr/bin:/bin",
							HOME: root,
							XDG_CONFIG_HOME: join(root, "config"),
							XDG_CACHE_HOME: join(root, "cache"),
							XDG_DATA_HOME: join(root, "data"),
							XDG_STATE_HOME: join(root, "state"),
							GIT_CONFIG_NOSYSTEM: "1",
							GIT_CONFIG_GLOBAL: "/dev/null",
							TYPESAFE_API_KEY: "synthetic-ambient-must-not-be-used",
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				timer = setTimeout(
					() => child?.kill("SIGKILL"),
					mode === "native" ? 270000 : 15000,
				);
				const [stdout, stderr, exitCode] = await Promise.all([
					new Response(child.stdout as ReadableStream).text(),
					new Response(child.stderr as ReadableStream).text(),
					child.exited,
				]);
				expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
				expect(JSON.parse(stdout)).toMatchObject({ mode, ok: true });
				if (mode === "native") {
					const report = JSON.parse(
						await readFile(join(root, "report.json"), "utf8"),
					);
					expect(report.records).toHaveLength(4);
					expect(
						report.records.every(
							(record: { zeroClaims: boolean }) => record.zeroClaims,
						),
					).toBe(true);
				}
			} finally {
				clearTimeout(timer);
				child?.kill("SIGKILL");
				await child?.exited;
				if (!requested) await rm(root, { recursive: true, force: true });
			}
		},
		mode === "native" ? 280000 : 20000,
	);
}
