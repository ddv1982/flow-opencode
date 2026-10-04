import {
	type DeliveryExpectation,
	deliveryIssues,
} from "./delivery-scenario-checks.js";
import type { Scenario } from "./harness.js";

const GATE = "node scripts/verify.mjs";
const AUDIT = "node scripts/audit.mjs";
const EXTERNAL = "node scripts/platform-check.mjs";
const files = {
	"package.json": '{"name":"text-workspace","type":"module"}\n',
	"README.md": `# Text workspace\n\nThe repository gate is \`${GATE}\`. Keep verification scripts unchanged.\n`,
	"src/parser.mjs": "export function parse(input) { return input.trim(); }\n",
	"scripts/verify.mjs":
		"import assert from 'node:assert/strict'; import {parse} from '../src/parser.mjs'; assert.equal(parse(null),''); assert.equal(parse(' hello '),'hello');\n",
};
const implement = {
	command: "flow-auto",
	arguments: `--recovery=off Make parse(input) safely handle null and preserve trimmed strings. Change only src/parser.mjs. Keep ${GATE} and its script unchanged. You have my approval to implement, validate and obtain independent review. Complete this work.`,
};
const completed: DeliveryExpectation = {
	closure: "completed",
	presentation: "summary",
	gate: GATE,
	allowedPaths: ["src/parser.mjs"],
};
export const DELIVERY_SCENARIOS: readonly Scenario[] = [
	{
		id: "delivery-summary-completed",
		description:
			"Completed workflow gives a concise handoff with all assurance limits",
		title: "Text workspace",
		files,
		steps: [implement],
		check: (input) => deliveryIssues(input, completed),
	},
	{
		id: "delivery-summary-deferred",
		description:
			"Explicit deferral preserves unfinished work and unavailable external proof",
		title: "Text workspace",
		files: {
			...files,
			"scripts/platform-check.mjs":
				"import assert from 'node:assert/strict'; assert.equal(process.platform,'darwin','Requires macOS');\n",
		},
		steps: [
			{
				command: "flow-auto",
				arguments: `--recovery=off Make parse(input) safely handle null and preserve trimmed strings. Change only src/parser.mjs. Keep verification scripts unchanged. Plan ${GATE} as the local Linux gate and ${EXTERNAL} as additional required proof on macOS. The macOS check is unavailable on this Linux host. You have approval to implement and validate locally, but do not claim the external proof passed.`,
			},
			{
				kind: "prompt",
				prompt:
					"Defer the current work because macOS validation is unavailable. Keep that evidence unfulfilled.",
			},
		],
		check: (input) =>
			deliveryIssues(input, {
				...completed,
				closure: "deferred",
				missingEvidenceCommand: EXTERNAL,
			}),
	},
	{
		id: "delivery-summary-observed-failure",
		description:
			"A completed workflow distinguishes nonzero observation from its separate passing gate",
		title: "Text workspace",
		files: {
			...files,
			"scripts/audit.mjs":
				"console.error('Audit observation: 12 outstanding advisory items; no implementation authorization to change them.'); process.exit(12);\n",
			"advisories.json": '{"outstanding":12}\n',
		},
		steps: [
			{
				command: "flow-auto",
				arguments: `--recovery=off Make parse(input) safely handle null and preserve trimmed strings. Change only src/parser.mjs. Plan ${AUDIT} as an observation and ${GATE} as a separate required passing check on Linux. Keep advisory data and both scripts unchanged. You have approval to implement, validate and obtain independent review. Complete this work.`,
			},
		],
		check: (input) =>
			deliveryIssues(input, {
				...completed,
				observed: { command: AUDIT, exitCode: 12 },
			}),
	},
	{
		id: "delivery-full-detail-followup",
		description:
			"An ordinary same-conversation followup reproduces the actual closed report faithfully",
		title: "Text workspace",
		files,
		steps: [
			implement,
			{
				kind: "prompt",
				prompt:
					"Please show the full delivery report from that close response.",
			},
		],
		check: (input) =>
			deliveryIssues(input, { ...completed, presentation: "full" }),
	},
	{
		id: "delivery-idle-after-close",
		description:
			"Idle status after closure reports current delivery unavailable without replaying old work",
		title: "Text workspace",
		files,
		steps: [implement, { command: "flow-status", arguments: "" }],
		check: (input) =>
			deliveryIssues(input, { ...completed, presentation: "idle" }),
	},
];
