import { isFeatureId } from "./feature-id.js";
import { MAX_PLAN_BYTES, MAX_PLAN_FEATURES } from "./limits.js";
import type { Plan } from "./session.js";
import { narrowingArguments } from "./validation.js";

/**
 * Why a declared canonical gate cannot be the plan's `gate`.
 *
 * The same rule `recordValidation` applies to a broad claim, applied one step
 * earlier: a gate declared at planning time is checked before any code is written,
 * so a plan that names a hand-picked subset as the whole suite is refused while it
 * is still cheap to fix. Nothing here decides whether the command is a *test* —
 * that stays a whitelist — only that it does not already say it is narrow.
 */
function gateIssue(gate: string): string | null {
	const narrowing = narrowingArguments(gate);
	return narrowing.length === 0
		? null
		: `The plan's canonical gate cannot select which tests it runs (${narrowing.join(", ")}).`;
}

export function planIssue(plan: Plan): string | null {
	if (plan.gate !== undefined) {
		const issue = gateIssue(plan.gate);
		if (issue) return issue;
	}
	if (Buffer.byteLength(JSON.stringify(plan), "utf8") > MAX_PLAN_BYTES) {
		return `A plan may contain at most ${MAX_PLAN_BYTES} UTF-8 bytes.`;
	}
	if (plan.features.length < 1 || plan.features.length > MAX_PLAN_FEATURES) {
		return `A plan must contain 1-${MAX_PLAN_FEATURES} features.`;
	}
	const ids = new Set<string>();
	for (const feature of plan.features) {
		if (!isFeatureId(feature.id)) return `Invalid feature id '${feature.id}'.`;
		if (ids.has(feature.id)) return `Duplicate feature id '${feature.id}'.`;
		ids.add(feature.id);
	}
	for (const feature of plan.features) {
		for (const dependency of feature.dependsOn) {
			if (!ids.has(dependency)) {
				return `Feature '${feature.id}' depends on unknown feature '${dependency}'.`;
			}
			if (dependency === feature.id) {
				return `Feature '${feature.id}' cannot depend on itself.`;
			}
		}
	}
	const indegree = new Map(plan.features.map((feature) => [feature.id, 0]));
	const children = new Map(
		plan.features.map((feature) => [feature.id, [] as string[]]),
	);
	for (const feature of plan.features) {
		for (const dependency of new Set(feature.dependsOn)) {
			indegree.set(feature.id, (indegree.get(feature.id) ?? 0) + 1);
			children.get(dependency)?.push(feature.id);
		}
	}
	const queue = [...indegree.entries()]
		.filter(([, degree]) => degree === 0)
		.map(([id]) => id);
	let visited = 0;
	while (queue.length > 0) {
		const id = queue.shift();
		if (!id) continue;
		visited += 1;
		for (const child of children.get(id) ?? []) {
			const next = (indegree.get(child) ?? 0) - 1;
			indegree.set(child, next);
			if (next === 0) queue.push(child);
		}
	}
	return visited === plan.features.length
		? null
		: "The plan dependency graph is cyclic.";
}
