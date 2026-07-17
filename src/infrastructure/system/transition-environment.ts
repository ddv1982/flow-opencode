import { randomUUID } from "node:crypto";
import { toSessionId } from "../../domain/session.js";
import type { TransitionEnvironment } from "../../domain/transitions.js";

export const systemTransitionEnvironment: TransitionEnvironment = {
	now: () => new Date().toISOString(),
	newSessionId: () => toSessionId(randomUUID()),
};
