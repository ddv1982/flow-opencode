import { expect, test } from "bun:test";
import { object } from "../evals/native-auth/protocol.js";

test.skipIf(!process.env.FLOW_OPENCODE_NATIVE_EXECUTABLE)(
	"native account broker and private CLI discovery preserve source-owned OAuth with no fallback",
	async () => {
		const child = Bun.spawn(
			[
				process.execPath,
				new URL("./fixtures/native-auth-smoke.ts", import.meta.url).pathname,
			],
			{
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, , code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code).toBe(0);
		const receipt: unknown = JSON.parse(stdout);
		expect(
			object(receipt) &&
				receipt.status === "passed" &&
				receipt.processesStopped === true,
		).toBe(true);
		if (!object(receipt)) throw new Error("Missing private native proof");
		expect(receipt.defaultCliAuthenticated).toBe(true);
		expect(receipt.exactRpcQueryAccepted).toBe(true);
		expect(receipt.childPluginsActiveBeforeCredentialImport).toBe(true);
		expect(receipt.ambientFallbackRefused).toBe(true);
		expect(receipt.otherAccountRefused).toBe(true);
		expect(receipt.validCachedAccessRefusedWithoutSource).toBe(true);
		expect(receipt.nativeBearerVerified).toBe(true);
		expect(receipt.sourceLocationEvicted).toBe(true);
	},
	60000,
);
