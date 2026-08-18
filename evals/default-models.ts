/**
 * Same three families Cursor exposes, on three OpenCode providers.
 *
 * The eval host is OpenCode. It cannot call Cursor's catalog. Qualification
 * counts the first slash as the vendor, so these cannot share an `opencode/`
 * prefix or a single-key Zen pass would clear a two-provider bar.
 */
export const DEFAULT_EVAL_MODELS = [
	"openai/gpt-5.6-sol",
	"opencode/claude-sonnet-5",
	"xai/grok-4.5",
] as const;

const PROVIDER_CREDENTIAL: Readonly<Record<string, string>> = {
	openai: "OPENAI_API_KEY",
	opencode: "OPENCODE_API_KEY",
	xai: "XAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
};

export function parseEvalModelList(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function credentialName(model: string): string | undefined {
	const slash = model.indexOf("/");
	if (slash <= 0) return undefined;
	return PROVIDER_CREDENTIAL[model.slice(0, slash)];
}

export function modelsCoveredByEnv(
	models: readonly string[],
	env: NodeJS.ProcessEnv,
): string[] {
	return models.filter((model) => {
		const name = credentialName(model);
		return name !== undefined && Boolean(env[name]?.trim());
	});
}

export function defaultEvalMatrixForCi(env: NodeJS.ProcessEnv): string[] {
	const covered = modelsCoveredByEnv(DEFAULT_EVAL_MODELS, env);
	const vendorCount = new Set(
		covered.flatMap((model) => {
			const slash = model.indexOf("/");
			return slash > 0 ? [model.slice(0, slash)] : [];
		}),
	).size;
	return vendorCount >= 2 ? covered : [];
}
