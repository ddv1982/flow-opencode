#!/usr/bin/env bun

import { normalizeRequestedModel } from "../evals/provenance.js";
import { assertReleaseModels } from "../evals/release-policy.js";
import packageJson from "../package.json" with { type: "json" };

const configured = process.env.FLOW_EVAL_MODEL?.trim();
if (!configured)
	throw new Error("FLOW_EVAL_MODEL is required for a release matrix.");

const models = configured.split(",").map((entry) => {
	const modelId = entry.trim();
	const boundary = modelId.indexOf("/");
	const routedModel = modelId.slice(boundary + 1);
	return normalizeRequestedModel({
		modelId,
		gateway: routedModel.includes("/") ? modelId.slice(0, boundary) : null,
		family: routedModel,
		revision: null,
	});
});
assertReleaseModels(models, packageJson.version);
