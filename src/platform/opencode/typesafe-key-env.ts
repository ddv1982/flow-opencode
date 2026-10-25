export function resolveTypesafeApiKeyReader(options: {
	pluginOptions: Readonly<Record<string, unknown>>;
	env?: Readonly<Record<string, string | undefined>>;
	onWarning?: (message: string) => void;
}): () => string | undefined {
	const configured = options.pluginOptions.typesafeApiKeyEnv;
	const name = configured === undefined ? "TYPESAFE_API_KEY" : configured;
	if (
		typeof name !== "string" ||
		!/^[A-Za-z_]/.test(name) ||
		/[^A-Za-z0-9_]/.test(name)
	) {
		options.onWarning?.(
			"Flow plugin option typesafeApiKeyEnv must be a portable environment variable name; Typesafe advice is disabled.",
		);
		return () => undefined;
	}
	const env = options.env ?? process.env;
	return () => {
		const value = Object.hasOwn(env, name) ? env[name] : undefined;
		return value?.trim() || undefined;
	};
}
