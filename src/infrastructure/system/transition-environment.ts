import { randomUUID } from "node:crypto";
import type { TransitionEnvironment } from "../../domain/transitions.js";

export const systemTransitionEnvironment: TransitionEnvironment = {
	newId: (kind) => `${kind}:${randomUUID()}`,
};
