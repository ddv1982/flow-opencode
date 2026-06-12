// Passive update notice: OpenCode caches plugin installs per spec string and
// never re-resolves them, so a user can keep running a stale version with no
// signal anywhere. After startup we compare the running version against the
// npm `latest` dist-tag and log a notice when a newer release exists. We only
// ever notify — the user's opencode.json pin is their intent and is never
// rewritten (see oh-my-opencode#1745 for how auto-rewriting goes wrong).

const NPM_LATEST_URL = "https://registry.npmjs.org/opencode-plugin-flow/latest";
const FETCH_TIMEOUT_MS = 3000;

export const FLOW_UPDATE_CHECK_OPT_OUT_ENV = "FLOW_DISABLE_UPDATE_CHECK";

type FlowUpdateLog = (level: "info" | "warn", message: string) => void;

type FlowUpdateCheckDeps = {
	fetchJson?: (url: string, timeoutMs: number) => Promise<unknown>;
	env?: Record<string, string | undefined>;
};

type FlowUpdateCheckResult = {
	latestVersion: string;
	updateAvailable: boolean;
};

async function defaultFetchJson(
	url: string,
	timeoutMs: number,
): Promise<unknown> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`Unexpected status ${response.status}`);
	}
	return response.json();
}

function parseSemverParts(version: string): [number, number, number] | null {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
	const candidateParts = parseSemverParts(candidate);
	const currentParts = parseSemverParts(current);
	if (!candidateParts || !currentParts) {
		return false;
	}
	for (let index = 0; index < 3; index += 1) {
		const a = candidateParts[index] ?? 0;
		const b = currentParts[index] ?? 0;
		if (a !== b) {
			return a > b;
		}
	}
	return false;
}

export async function checkForFlowUpdate(
	currentVersion: string,
	deps: FlowUpdateCheckDeps = {},
): Promise<FlowUpdateCheckResult | null> {
	const fetchJson = deps.fetchJson ?? defaultFetchJson;
	try {
		const payload = await fetchJson(NPM_LATEST_URL, FETCH_TIMEOUT_MS);
		const latestVersion =
			payload && typeof payload === "object" && "version" in payload
				? (payload as { version?: unknown }).version
				: undefined;
		if (typeof latestVersion !== "string" || !parseSemverParts(latestVersion)) {
			return null;
		}
		return {
			latestVersion,
			updateAvailable: isNewerVersion(latestVersion, currentVersion),
		};
	} catch {
		// Offline, registry down, or blocked network: the notice is best-effort
		// and must never surface an error or delay startup.
		return null;
	}
}

/**
 * Fire-and-forget: never blocks plugin init, never throws, logs only when a
 * newer version exists. Skipped for the 0.0.0 sandbox sentinel and when the
 * opt-out env var is set (CI smokes set it to stay network-free).
 */
export function scheduleFlowUpdateNotice(
	currentVersion: string,
	log: FlowUpdateLog,
	deps: FlowUpdateCheckDeps = {},
): void {
	const env = deps.env ?? process.env;
	if (currentVersion === "0.0.0" || env[FLOW_UPDATE_CHECK_OPT_OUT_ENV]) {
		return;
	}
	void checkForFlowUpdate(currentVersion, deps)
		.then((result) => {
			if (result?.updateAvailable) {
				log(
					"info",
					`Flow ${result.latestVersion} is available (running ${currentVersion}). OpenCode does not auto-update plugins: change the pin in opencode.json to "opencode-plugin-flow@${result.latestVersion}" and restart OpenCode twice.`,
				);
			}
		})
		.catch(() => {});
}
