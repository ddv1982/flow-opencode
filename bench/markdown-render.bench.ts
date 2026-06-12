import { bench } from "mitata";
import { renderFeatureDoc, renderIndexDoc } from "../src/runtime/render";
import { createApprovedSession, createMidExecutionSession } from "./fixtures";

const midExecution = createMidExecutionSession(10);
const largePlan = createApprovedSession(20);
const activeFeature =
	midExecution.plan?.features.find(
		(feature) => feature.id === midExecution.execution.activeFeatureId,
	) ?? null;

if (!activeFeature) {
	throw new Error("Expected active feature for markdown benchmark.");
}

bench("markdown render | index", () => {
	renderIndexDoc(largePlan);
});

bench("markdown render | feature", () => {
	renderFeatureDoc(midExecution, activeFeature);
});
