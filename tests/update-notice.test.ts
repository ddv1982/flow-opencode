import { describe, expect, test } from "bun:test";
import {
	checkForFlowUpdate,
	FLOW_UPDATE_CHECK_OPT_OUT_ENV,
	isNewerVersion,
	scheduleFlowUpdateNotice,
} from "../src/distribution/update-notice";

type LoggedNotice = { level: "info" | "warn"; message: string };

function collectNotices(): {
	notices: LoggedNotice[];
	log: (level: "info" | "warn", message: string) => void;
} {
	const notices: LoggedNotice[] = [];
	return {
		notices,
		log: (level, message) => {
			notices.push({ level, message });
		},
	};
}

async function settled() {
	// scheduleFlowUpdateNotice is fire-and-forget; drain the microtask queue
	// so its .then chain has run before we assert.
	await new Promise((resolve) => setImmediate(resolve));
}

describe("isNewerVersion", () => {
	test("compares each semver part numerically", () => {
		expect(isNewerVersion("3.2.0", "3.1.9")).toBe(true);
		expect(isNewerVersion("4.0.0", "3.99.99")).toBe(true);
		expect(isNewerVersion("3.1.10", "3.1.9")).toBe(true);
		expect(isNewerVersion("3.1.0", "3.1.0")).toBe(false);
		expect(isNewerVersion("3.0.9", "3.1.0")).toBe(false);
	});

	test("treats unparseable versions as not newer", () => {
		expect(isNewerVersion("not-a-version", "3.1.0")).toBe(false);
		expect(isNewerVersion("3.2.0", "unknown")).toBe(false);
	});
});

describe("checkForFlowUpdate", () => {
	test("reports an available update when latest is newer", async () => {
		const result = await checkForFlowUpdate("3.1.0", {
			fetchJson: async () => ({ version: "3.2.0" }),
		});
		expect(result).toEqual({ latestVersion: "3.2.0", updateAvailable: true });
	});

	test("reports no update when latest matches or trails", async () => {
		const same = await checkForFlowUpdate("3.2.0", {
			fetchJson: async () => ({ version: "3.2.0" }),
		});
		expect(same?.updateAvailable).toBe(false);
		const older = await checkForFlowUpdate("3.2.0", {
			fetchJson: async () => ({ version: "3.1.0" }),
		});
		expect(older?.updateAvailable).toBe(false);
	});

	test("returns null when the registry payload has no usable version", async () => {
		expect(
			await checkForFlowUpdate("3.1.0", { fetchJson: async () => ({}) }),
		).toBeNull();
		expect(
			await checkForFlowUpdate("3.1.0", { fetchJson: async () => null }),
		).toBeNull();
		expect(
			await checkForFlowUpdate("3.1.0", {
				fetchJson: async () => ({ version: "weird-tag" }),
			}),
		).toBeNull();
	});

	test("returns null instead of throwing when the fetch fails", async () => {
		const result = await checkForFlowUpdate("3.1.0", {
			fetchJson: async () => {
				throw new Error("offline");
			},
		});
		expect(result).toBeNull();
	});
});

describe("scheduleFlowUpdateNotice", () => {
	test("logs a pin-bump notice when a newer version exists", async () => {
		const { notices, log } = collectNotices();
		scheduleFlowUpdateNotice("3.1.0", log, {
			fetchJson: async () => ({ version: "3.2.0" }),
			env: {},
		});
		await settled();
		expect(notices).toHaveLength(1);
		expect(notices[0]?.level).toBe("info");
		expect(notices[0]?.message).toContain("Flow 3.2.0 is available");
		expect(notices[0]?.message).toContain("running 3.1.0");
		expect(notices[0]?.message).toContain('"opencode-plugin-flow@3.2.0"');
	});

	test("stays silent when already on the latest version", async () => {
		const { notices, log } = collectNotices();
		scheduleFlowUpdateNotice("3.2.0", log, {
			fetchJson: async () => ({ version: "3.2.0" }),
			env: {},
		});
		await settled();
		expect(notices).toHaveLength(0);
	});

	test("stays silent when the registry is unreachable", async () => {
		const { notices, log } = collectNotices();
		scheduleFlowUpdateNotice("3.1.0", log, {
			fetchJson: async () => {
				throw new Error("offline");
			},
			env: {},
		});
		await settled();
		expect(notices).toHaveLength(0);
	});

	test("skips the check entirely when the opt-out env var is set", async () => {
		const { notices, log } = collectNotices();
		let fetched = false;
		scheduleFlowUpdateNotice("3.1.0", log, {
			fetchJson: async () => {
				fetched = true;
				return { version: "9.9.9" };
			},
			env: { [FLOW_UPDATE_CHECK_OPT_OUT_ENV]: "1" },
		});
		await settled();
		expect(fetched).toBe(false);
		expect(notices).toHaveLength(0);
	});

	test("skips the check for the 0.0.0 fallback version", async () => {
		const { notices, log } = collectNotices();
		let fetched = false;
		scheduleFlowUpdateNotice("0.0.0", log, {
			fetchJson: async () => {
				fetched = true;
				return { version: "3.2.0" };
			},
			env: {},
		});
		await settled();
		expect(fetched).toBe(false);
		expect(notices).toHaveLength(0);
	});
});
