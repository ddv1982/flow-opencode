import { bench } from "mitata";
import {
	PlanSchema,
	SessionSchema,
	WorkerResultSchema,
} from "../src/runtime/schema";
import {
	createApprovedSession,
	createPlan,
	createWorkerResult,
} from "./fixtures";

const session = createApprovedSession(20);
const plan = createPlan(20);
const worker = createWorkerResult("feature-1");

bench("zod parse hot paths | SessionSchema.parse", () => {
	SessionSchema.parse(session);
});

bench("zod parse hot paths | PlanSchema.parse", () => {
	PlanSchema.parse(plan);
});

bench("zod parse hot paths | WorkerResultSchema.parse", () => {
	WorkerResultSchema.parse(worker);
});
