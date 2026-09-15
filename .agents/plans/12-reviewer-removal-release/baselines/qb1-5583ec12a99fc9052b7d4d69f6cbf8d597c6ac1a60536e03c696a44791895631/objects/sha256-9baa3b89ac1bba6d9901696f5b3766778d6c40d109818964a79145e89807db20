import { canonicalSha256 } from "./canonical-json.js";

const METHOD = "equal-task-cluster-bootstrap-v1";
const MIN_SAMPLES = 2_000;
const DEFAULT_SAMPLES = MIN_SAMPLES;
const MAX_SAMPLES = 100_000;
const MAX_TASK_DRAWS = 100_000_000;

export const STUDY_STATISTICS_VERSION_SHA256 = canonicalSha256(
	"flow-study-statistics-implementation-v1",
	{
		method: METHOD,
		estimand: "equal-task-mean-of-first-minus-second-paired-outcomes",
		resampling: "whole-task-means-with-replacement",
		taskOrder: "json-case-id-version-tuple-utf16-ascending",
		random: "fnv1a-code-point-seed-mulberry32-uint32-state",
		interval: "sorted-floor-(samples-1)*0.025-ceil-(samples-1)*0.975",
		minimumIntervalTasks: 2,
		minSamples: MIN_SAMPLES,
		defaultSamples: DEFAULT_SAMPLES,
		maxSamples: MAX_SAMPLES,
		maxTaskDraws: MAX_TASK_DRAWS,
		duplicateRepetitions: "reject",
		power: "unestablished",
	},
);

export type TaskClusterObservation = {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly repetition: number;
	readonly outcomes: readonly [boolean, boolean];
};

export type TaskClusterAnalysis = {
	readonly method: typeof METHOD;
	readonly estimate: number | null;
	readonly interval95: readonly [number, number] | null;
	readonly distinctTasks: number;
	readonly completePairs: number;
	readonly power: { readonly kind: "unestablished" };
};

function validText(value: string): boolean {
	return (
		typeof value === "string" &&
		value.length <= 4096 &&
		/\S/.test(value) &&
		value.isWellFormed()
	);
}

function seededRandom(seed: string): () => number {
	let state = 0x811c9dc5;
	for (const character of seed) {
		state = Math.imul(state ^ (character.codePointAt(0) ?? 0), 0x01000193);
	}
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function analyzeTaskClusters(input: {
	readonly observations: readonly TaskClusterObservation[];
	readonly seed: string;
	readonly samples?: number;
}): TaskClusterAnalysis {
	const sampleCount =
		input.samples === undefined ? DEFAULT_SAMPLES : input.samples;
	if (
		!Number.isSafeInteger(sampleCount) ||
		sampleCount < MIN_SAMPLES ||
		sampleCount > MAX_SAMPLES
	) {
		throw new Error(
			"Bootstrap samples must be an integer from 2000 to 100000.",
		);
	}
	if (!validText(input.seed)) {
		throw new Error(
			"Bootstrap seed must be nonblank, well-formed text up to 4096 characters.",
		);
	}
	if (!Array.isArray(input.observations)) {
		throw new Error("Task-cluster observations must be an array.");
	}
	const tasks = new Map<
		string,
		{ differenceSum: number; repetitions: Set<number> }
	>();
	for (const pair of input.observations) {
		if (
			!pair ||
			!validText(pair.caseId) ||
			!Number.isSafeInteger(pair.caseVersion) ||
			pair.caseVersion < 1 ||
			!Number.isSafeInteger(pair.repetition) ||
			pair.repetition < 0 ||
			!Array.isArray(pair.outcomes) ||
			pair.outcomes.length !== 2 ||
			typeof pair.outcomes[0] !== "boolean" ||
			typeof pair.outcomes[1] !== "boolean"
		) {
			throw new Error("Invalid task-cluster paired observation.");
		}
		const key = JSON.stringify([pair.caseId, pair.caseVersion]);
		const task = tasks.get(key) ?? {
			differenceSum: 0,
			repetitions: new Set<number>(),
		};
		if (task.repetitions.has(pair.repetition)) {
			throw new Error("Task-cluster repetition identities must be unique.");
		}
		task.repetitions.add(pair.repetition);
		task.differenceSum += Number(pair.outcomes[0]) - Number(pair.outcomes[1]);
		tasks.set(key, task);
	}
	if (tasks.size > Math.floor(MAX_TASK_DRAWS / sampleCount)) {
		throw new Error("Bootstrap exceeds the 100000000 task-draw limit.");
	}
	const taskMeans = [...tasks.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([, task]) => task.differenceSum / task.repetitions.size);
	const result: TaskClusterAnalysis = {
		method: METHOD,
		estimate:
			taskMeans.length === 0
				? null
				: taskMeans.reduce((sum, mean) => sum + mean, 0) / taskMeans.length,
		interval95: null,
		distinctTasks: taskMeans.length,
		completePairs: input.observations.length,
		power: { kind: "unestablished" },
	};
	if (taskMeans.length < 2) return result;
	const draw = seededRandom(input.seed);
	const samples: number[] = [];
	for (let sample = 0; sample < sampleCount; sample += 1) {
		let sum = 0;
		for (let index = 0; index < taskMeans.length; index += 1) {
			const mean = taskMeans[Math.floor(draw() * taskMeans.length)];
			if (mean === undefined)
				throw new Error("Bootstrap task mean is missing.");
			sum += mean;
		}
		samples.push(sum / taskMeans.length);
	}
	samples.sort((left, right) => left - right);
	const lower = samples[Math.floor((sampleCount - 1) * 0.025)];
	const upper = samples[Math.ceil((sampleCount - 1) * 0.975)];
	if (lower === undefined || upper === undefined) {
		throw new Error("Bootstrap produced no samples.");
	}
	return { ...result, interval95: [lower, upper] };
}
