type BenchmarkFilter = "transitions" | "render" | "saveSession" | "zod";

const BENCHMARK_MODULES: Record<BenchmarkFilter, string> = {
	transitions: "./transition-reducer.bench",
	render: "./markdown-render.bench",
	saveSession: "./save-session.bench",
	zod: "./zod-parse-hot-paths.bench",
};

function parseFilter(argv: readonly string[]): BenchmarkFilter | null {
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		if (argument === "--filter") {
			const value = argv[index + 1];

			if (value && value in BENCHMARK_MODULES) {
				return value as BenchmarkFilter;
			}

			return null;
		}

		if (argument.startsWith("--filter=")) {
			const value = argument.slice("--filter=".length);

			if (value in BENCHMARK_MODULES) {
				return value as BenchmarkFilter;
			}

			return null;
		}
	}

	return null;
}

const filter = parseFilter(process.argv.slice(2));

if (filter) {
	await import(BENCHMARK_MODULES[filter]);
} else {
	await import("./session-save-round-trip.bench");
	await import("./transition-reducer.bench");
	await import("./markdown-render.bench");
	await import("./zod-parse-hot-paths.bench");
	await import("./save-session.bench");
}

await import("mitata").then(({ run }) => run());
