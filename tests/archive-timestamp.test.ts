import { describe, expect, test } from "bun:test";
import { toArchiveTimestamp } from "../src/runtime/util";

describe("toArchiveTimestamp", () => {
	test("strips trailing Z for millisecond and non-millisecond ISO timestamps", () => {
		expect(toArchiveTimestamp("2025-04-05T19:42:13.482Z")).toBe(
			"20250405T194213.482",
		);
		expect(toArchiveTimestamp("2025-04-05T19:42:13Z")).toBe("20250405T194213");
		expect(toArchiveTimestamp("2025-04-05T19:42:13")).toBe("20250405T194213");
	});
});
