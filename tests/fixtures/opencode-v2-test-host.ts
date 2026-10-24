import { OpenCode } from "@opencode/client";
import {
	type CredentialSync,
	type EvalHost,
	syncProviderCredentialsBack,
} from "../../evals/harness.js";

export function nativeTestClient() {
	return OpenCode.make({
		baseUrl: "http://fixture",
		fetch: Object.assign(
			(...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
			{ preconnect: fetch.preconnect },
		),
	});
}

export function fileCredentialHandoff(
	host: EvalHost,
	paths: CredentialSync,
): void {
	Object.assign(host, {
		nativeClient: {
			session: { active: async () => ({}) },
			credential: { list: async () => [] },
		},
		credentialHandoff: {
			before: [],
			onStop: () => syncProviderCredentialsBack(paths),
		},
	});
}
