import type { prepareFlowCommand } from "../../src/platform/opencode/command-hook.js";
import { registerFlowLifecycle } from "../../src/platform/opencode/lifecycle.js";
import { createNativeFlowHost } from "./native-flow-host.js";

type Options = Parameters<typeof registerFlowLifecycle>[0];
type CommandName = Parameters<typeof prepareFlowCommand>[0];
export async function continuationCommands(
	options: Omit<Options, "ctx" | "runtimeGuard" | "log" | "codingModels">,
) {
	const native = await createNativeFlowHost(process.cwd());
	const lifecycle = await registerFlowLifecycle({
		...options,
		ctx: native.context,
		runtimeGuard: {
			assertOperational() {},
			query: () => ({
				operational: true,
				reason: "sole-instance",
				message: "active",
			}),
			release: () => true,
		},
		log() {},
		codingModels: new Map(),
	});
	return {
		native,
		lifecycle,
		async execute(name: CommandName, args: string, host = "ses_host") {
			native.ensureSession(host, {
				agent: "build",
				model: { providerID: "test", id: "manager" },
			});
			await native.command(name, args, host);
			const input = native.admissions.findLast(
				(input) => input.type === "user" && input.sessionID === host,
			);
			if (input?.type !== "user")
				throw new Error("Missing accepted native command receipt.");
			const authority = options.autoDrive.captureAuthority(host);
			return {
				id: input.id,
				text: input.payload.text,
				metadata: authority
					? { "opencode-plugin-flow/auto": authority.token }
					: null,
			};
		},
		dispose: async () => {
			await lifecycle.dispose();
			await native.dispose();
		},
	};
}
