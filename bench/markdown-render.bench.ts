import { bench } from "mitata";
import { renderFeatureDoc } from "../src/runtime/render-feature-sections";
import { renderIndexDoc } from "../src/runtime/render-index-sections";
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
