import type { z } from "zod";
import { ReplayFixtureSchema } from "./contract.js";
import { ReplayPrivacyError, validateReplayFixturePrivacy } from "./privacy.js";

export * from "./canonical-json.js";
export * from "./contract.js";
export * from "./engine.js";
export * from "./privacy.js";

export function parseReplayFixture(
	raw: unknown,
): z.infer<typeof ReplayFixtureSchema> {
	const privacy = validateReplayFixturePrivacy(raw);
	if (!privacy.safe) {
		throw new ReplayPrivacyError(privacy.violations);
	}
	return ReplayFixtureSchema.parse(raw);
}
