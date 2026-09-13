import { describe, expect, test } from "bun:test";
import {
	analyzeTaskClusters,
	STUDY_STATISTICS_VERSION_SHA256,
	type TaskClusterObservation,
} from "../evals/study-statistics.js";

function task(
	caseId: string,
	outcomes: readonly (readonly [boolean, boolean])[],
	caseVersion = 1,
): TaskClusterObservation[] {
	return outcomes.map((pair, repetition) => ({
		caseId,
		caseVersion,
		repetition,
		outcomes: pair,
	}));
}

const mixedTasks = [
	...task("first", [[true, false]]),
	...task("second", [
		[false, true],
		[true, true],
	]),
	...task("third", [
		[true, false],
		[true, false],
		[false, true],
	]),
	...task("fourth", [[true, true]]),
	...task("fifth", [
		[true, false],
		[false, false],
	]),
	...task("sixth", [[false, true]]),
];

describe("equal-task cluster bootstrap", () => {
	test("reports no estimate or interval without complete pairs", () => {
		expect(analyzeTaskClusters({ observations: [], seed: "empty" })).toEqual({
			method: "equal-task-cluster-bootstrap-v1",
			estimate: null,
			interval95: null,
			distinctTasks: 0,
			completePairs: 0,
			power: { kind: "unestablished" },
		});
	});

	test("reports one task's paired mean without a cross-task interval", () => {
		const result = analyzeTaskClusters({
			observations: task("only", [
				[true, false],
				[true, true],
				[false, false],
			]),
			seed: "single",
		});
		expect(result.estimate).toBe(1 / 3);
		expect(result.interval95).toBeNull();
		expect(result.distinctTasks).toBe(1);
		expect(result.completePairs).toBe(3);
		expect(result.power).toEqual({ kind: "unestablished" });
	});

	test("retains task variation across 200 identical within-task pairs", () => {
		const result = analyzeTaskClusters({
			observations: [
				...task(
					"positive",
					Array.from({ length: 100 }, () => [true, false] as const),
				),
				...task(
					"negative",
					Array.from({ length: 100 }, () => [false, true] as const),
				),
			],
			seed: "task-resampling-probe",
		});
		expect(result.estimate).toBe(0);
		expect(result.interval95).toEqual([-1, 1]);
		expect(result.distinctTasks).toBe(2);
		expect(result.completePairs).toBe(200);
		expect(result.power).toEqual({ kind: "unestablished" });
	});

	test("weights tasks equally despite unequal repetition counts", () => {
		const result = analyzeTaskClusters({
			observations: [
				...task("positive", [[true, false]]),
				...task(
					"negative",
					Array.from({ length: 100 }, () => [false, true] as const),
				),
			],
			seed: "unequal",
		});
		expect(result.estimate).toBe(0);
		expect(result.interval95).toEqual([-1, 1]);
		expect(result.completePairs).toBe(101);
	});

	test("duplicating within-task repetitions preserves estimate and interval", () => {
		const original = analyzeTaskClusters({
			observations: mixedTasks,
			seed: "duplicate",
		});
		const duplicated = analyzeTaskClusters({
			observations: [
				...mixedTasks,
				...mixedTasks.map((pair) => ({
					...pair,
					repetition: pair.repetition + 100,
				})),
			],
			seed: "duplicate",
		});
		expect(duplicated).toEqual({
			...original,
			completePairs: original.completePairs * 2,
		});
	});

	test("keeps versions of the same case in separate task clusters", () => {
		const result = analyzeTaskClusters({
			observations: [
				...task("same", [[true, false]], 1),
				...task("same", [[false, true]], 2),
			],
			seed: "versions",
		});
		expect(result.estimate).toBe(0);
		expect(result.interval95).toEqual([-1, 1]);
		expect(result.distinctTasks).toBe(2);
	});

	test.each([
		{ outcomes: [true, false] as const, difference: 1 },
		{ outcomes: [false, true] as const, difference: -1 },
		{ outcomes: [true, true] as const, difference: 0 },
		{ outcomes: [false, false] as const, difference: 0 },
	])(
		"preserves the constant paired difference $difference for $outcomes",
		({ outcomes, difference }) => {
			const result = analyzeTaskClusters({
				observations: [
					...task("a", [outcomes]),
					...task("b", [outcomes]),
					...task("c", [outcomes]),
				],
				seed: "endpoints",
			});
			expect(result.estimate).toBe(difference);
			expect(result.interval95).toEqual([difference, difference]);
			expect(result.power).toEqual({ kind: "unestablished" });
		},
	);

	test("preserves pairing when both arms alternate between passing and failing", () => {
		const result = analyzeTaskClusters({
			observations: [
				...task("a", [
					[true, true],
					[false, false],
				]),
				...task("b", [
					[false, false],
					[true, true],
				]),
			],
			seed: "paired-ties",
		});
		expect(result.estimate).toBe(0);
		expect(result.interval95).toEqual([0, 0]);
	});

	test("uses canonical task order without mutating observations", () => {
		const observations = Object.freeze(
			mixedTasks.map((pair) =>
				Object.freeze({
					...pair,
					outcomes: Object.freeze(pair.outcomes),
				}),
			),
		);
		const original = analyzeTaskClusters({ observations, seed: "permutation" });
		expect(
			analyzeTaskClusters({
				observations: [...observations].reverse(),
				seed: "permutation",
			}),
		).toEqual(original);
		expect(
			analyzeTaskClusters({
				observations: [...observations.slice(3), ...observations.slice(0, 3)],
				seed: "permutation",
			}),
		).toEqual(original);
	});

	test("reproduces the same seed and uses different seeds for resampling", () => {
		const first = analyzeTaskClusters({
			observations: mixedTasks,
			seed: "first-seed",
			samples: 2_000,
		});
		const second = analyzeTaskClusters({
			observations: mixedTasks,
			seed: "second-seed",
			samples: 2_000,
		});
		expect(first).toEqual({
			method: "equal-task-cluster-bootstrap-v1",
			estimate: 1 / 18,
			interval95: [-0.47222222222222227, 5 / 9],
			distinctTasks: 6,
			completePairs: 10,
			power: { kind: "unestablished" },
		});
		expect(first).toEqual(
			analyzeTaskClusters({
				observations: mixedTasks,
				seed: "first-seed",
				samples: 2_000,
			}),
		);
		expect(first.estimate).toBe(second.estimate);
		expect(first.interval95).not.toEqual(second.interval95);
	});

	test("defaults to 2000 samples and accepts the inclusive sample limits", () => {
		expect(
			analyzeTaskClusters({ observations: mixedTasks, seed: "default" }),
		).toEqual(
			analyzeTaskClusters({
				observations: mixedTasks,
				seed: "default",
				samples: 2_000,
			}),
		);
		const observations = [
			...task("a", [[true, false]]),
			...task("b", [[false, true]]),
		];
		for (const samples of [2_000, 100_000]) {
			const result = analyzeTaskClusters({
				observations,
				seed: "bounds",
				samples,
			});
			expect(result.estimate).toBe(0);
			expect(result.interval95).toEqual([-1, 1]);
		}
	});

	test("pins the statistics implementation version", () => {
		expect(STUDY_STATISTICS_VERSION_SHA256).toBe(
			"sha256:50795aa7b68e61c86840c0ecd3c0ef52bc835506ed4c1f38f31000181e7dda44",
		);
	});
});

describe("task-cluster input guards", () => {
	test.each([{ samples: 1 }, { samples: 1_999 }])(
		"rejects $samples samples for opposite task means",
		({ samples }) => {
			expect(() =>
				analyzeTaskClusters({
					observations: [
						...task("a", [[true, false]]),
						...task("b", [[false, true]]),
					],
					seed: "bounds",
					samples,
				}),
			).toThrow("Bootstrap samples");
		},
	);

	test.each([
		{ samples: 0 },
		{ samples: -1 },
		{ samples: 1 },
		{ samples: 1_999 },
		{ samples: 1.5 },
		{ samples: NaN },
		{ samples: Infinity },
		{ samples: -Infinity },
		{ samples: 100_001 },
		{ samples: Number.MAX_SAFE_INTEGER },
		{ samples: Number.MAX_SAFE_INTEGER + 1 },
	])(
		"rejects invalid sample count $samples even without observations",
		({ samples }) => {
			expect(() =>
				analyzeTaskClusters({ observations: [], seed: "seed", samples }),
			).toThrow("Bootstrap samples");
		},
	);

	test.each([
		{ label: "empty", seed: "" },
		{ label: "whitespace", seed: " \n\t" },
		{ label: "overlong", seed: "s".repeat(4097) },
		{ label: "malformed Unicode", seed: "\ud800" },
	])("rejects $label seed", ({ seed }) => {
		expect(() => analyzeTaskClusters({ observations: [], seed })).toThrow(
			"Bootstrap seed",
		);
	});

	test.each([
		{ label: "empty case ID", override: { caseId: "" } },
		{ label: "whitespace case ID", override: { caseId: "\n " } },
		{ label: "overlong case ID", override: { caseId: "c".repeat(4097) } },
		{ label: "malformed Unicode case ID", override: { caseId: "\ud800" } },
		{ label: "zero case version", override: { caseVersion: 0 } },
		{ label: "negative case version", override: { caseVersion: -1 } },
		{ label: "fractional case version", override: { caseVersion: 1.5 } },
		{ label: "NaN case version", override: { caseVersion: NaN } },
		{ label: "infinite case version", override: { caseVersion: Infinity } },
		{
			label: "unsafe case version",
			override: { caseVersion: Number.MAX_SAFE_INTEGER + 1 },
		},
		{ label: "negative repetition", override: { repetition: -1 } },
		{ label: "fractional repetition", override: { repetition: 0.5 } },
		{ label: "NaN repetition", override: { repetition: NaN } },
		{ label: "infinite repetition", override: { repetition: Infinity } },
		{
			label: "unsafe repetition",
			override: { repetition: Number.MAX_SAFE_INTEGER + 1 },
		},
	])("rejects $label", ({ override }) => {
		expect(() =>
			analyzeTaskClusters({
				observations: [
					{
						caseId: "task",
						caseVersion: 1,
						repetition: 0,
						outcomes: [true, false],
						...override,
					},
				],
				seed: "invalid",
			}),
		).toThrow("Invalid task-cluster paired observation");
	});

	test.each([null, "100", true])(
		"rejects nonnumeric sample count %j",
		(samples) => {
			expect(() =>
				Reflect.apply(analyzeTaskClusters, undefined, [
					{ observations: [], seed: "invalid", samples },
				]),
			).toThrow("Bootstrap samples");
		},
	);

	test("rejects a non-text seed", () => {
		expect(() =>
			Reflect.apply(analyzeTaskClusters, undefined, [
				{ observations: [], seed: 42 },
			]),
		).toThrow("Bootstrap seed");
	});

	test("rejects missing pairs in a sparse observations array", () => {
		expect(() =>
			analyzeTaskClusters({ observations: new Array(1), seed: "sparse" }),
		).toThrow("Invalid task-cluster paired observation");
	});

	test.each([
		null,
		undefined,
		{},
		{ outcomes: [true] },
		{ outcomes: [true, false, true] },
		{ outcomes: [true, 0] },
	])("rejects malformed complete pairs %j", (value) => {
		const pair =
			value === null || value === undefined
				? value
				: { caseId: "task", caseVersion: 1, repetition: 0, ...value };
		expect(() =>
			Reflect.apply(analyzeTaskClusters, undefined, [
				{ observations: [pair], seed: "malformed" },
			]),
		).toThrow("Invalid task-cluster paired observation");
	});

	test("rejects an absent observations array", () => {
		expect(() =>
			Reflect.apply(analyzeTaskClusters, undefined, [
				{ observations: null, seed: "malformed" },
			]),
		).toThrow("observations must be an array");
	});

	test("rejects repeated pair identities", () => {
		const observations = task("same", [[true, false]]);
		expect(() =>
			analyzeTaskClusters({
				observations: [...observations, ...observations],
				seed: "duplicate",
			}),
		).toThrow("repetition identities must be unique");
	});

	test("accepts safe integer endpoint identifiers", () => {
		const result = analyzeTaskClusters({
			observations: [
				{
					caseId: "task",
					caseVersion: Number.MAX_SAFE_INTEGER,
					repetition: Number.MAX_SAFE_INTEGER,
					outcomes: [true, false],
				},
			],
			seed: "safe",
		});
		expect(result.estimate).toBe(1);
		expect(result.distinctTasks).toBe(1);
	});

	test("rejects excessive total bootstrap draws before resampling", () => {
		const observations = Array.from({ length: 1_001 }, (_, index) => ({
			caseId: `task-${index}`,
			caseVersion: 1,
			repetition: 0,
			outcomes: [true, false] as const,
		}));
		expect(() =>
			analyzeTaskClusters({
				observations,
				seed: "work-bound",
				samples: 100_000,
			}),
		).toThrow("task-draw limit");
	});
});
