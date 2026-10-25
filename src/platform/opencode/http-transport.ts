import type { ProviderDomain } from "@opencode/plugin/promise/provider";

export function registerHttpTransport(
	provider: Pick<ProviderDomain, "transform">,
) {
	return provider.transform((editor) => {
		for (const entry of editor.list()) {
			editor.update(entry.provider.id, (current) => {
				current.settings = { ...current.settings, transport: "http" };
			});
			for (const model of entry.models.values())
				editor.models.update(entry.provider.id, model.id, (current) => {
					current.settings = { ...current.settings, transport: "http" };
					for (const variant of current.variants)
						variant.settings = { ...variant.settings, transport: "http" };
				});
		}
	});
}
