import { Plugin } from "@opencode/plugin";
import { registerHttpTransport } from "../src/platform/opencode/http-transport.js";

export const HTTP_TRANSPORT_PLUGIN_ID = "flow.eval.http-transport";

export default Plugin.define({
	id: HTTP_TRANSPORT_PLUGIN_ID,
	setup: async (ctx) => {
		const registration = await registerHttpTransport(ctx.provider);
		return () => registration.dispose();
	},
});
