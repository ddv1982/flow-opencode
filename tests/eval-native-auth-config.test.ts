import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeAccountConnection } from "../evals/native-auth/protocol.js";
import {
	nativeAuthenticationFromEnvironment,
	readNativeAccountConnection,
} from "../evals/native-auth-config.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
const configuration = {
	version: 1,
	url: "http://127.0.0.1:43123/",
	capability: "f".repeat(64),
	accounts: [
		{
			route: {
				providerID: "fixture",
				integrationID: "fixture-native",
				credentialID: "fixture-account",
				methodID: "fixture-method",
				label: "Synthetic account",
			},
		},
	],
} satisfies NativeAccountConnection;
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "native-auth-config-"));
	roots.push(directory);
	await chmod(directory, 0o700);
	const path = join(directory, "configuration.json");
	await writeFile(path, JSON.stringify(configuration), { mode: 0o600 });
	return { directory, path };
}

test("native account configuration remains disabled unless explicitly selected", async () => {
	expect(
		await nativeAuthenticationFromEnvironment(["fixture/model"], {}),
	).toBeUndefined();
});

test("private native account configuration loads without opening a source connection", async () => {
	const { path } = await fixture();
	const models = ["fixture/model"];
	const loaded = await nativeAuthenticationFromEnvironment(models, {
		FLOW_EVAL_NATIVE_AUTH: path,
	});
	models.push("unapproved/model");
	expect(loaded).toEqual({ configuration, models: ["fixture/model"] });
	expect(await readNativeAccountConnection(path)).toEqual(configuration);
});

for (const mode of [
	"public-directory",
	"public-file",
	"symlink",
	"hardlink",
	"oversized",
	"invalid-json",
	"invalid-connection",
] as const) {
	test(`native account configuration rejects ${mode} with a generic error`, async () => {
		const { directory, path } = await fixture();
		let selected = path;
		if (mode === "public-directory") await chmod(directory, 0o755);
		if (mode === "public-file") await chmod(path, 0o640);
		if (mode === "symlink") {
			selected = join(directory, "linked.json");
			await symlink(path, selected);
		}
		if (mode === "hardlink") await link(path, join(directory, "linked.json"));
		if (mode === "oversized")
			await writeFile(path, "x".repeat(1024 * 1024 + 1));
		if (mode === "invalid-json")
			await writeFile(path, '{"private-value":"synthetic-do-not-echo');
		if (mode === "invalid-connection")
			await writeFile(
				path,
				JSON.stringify({ ...configuration, url: "https://example.invalid/" }),
			);
		let message = "";
		try {
			await readNativeAccountConnection(selected);
		} catch (error) {
			message = String(error);
		}
		expect(message).toBe(
			"NativeAuthError: Native account authentication failed.",
		);
		expect(message).not.toContain("synthetic-do-not-echo");
		expect(message).not.toContain(path);
	});
}
