import { canonicalJson } from "./canonical-json.js";

type Closure = "completed" | "deferred" | "abandoned";
type Assurance =
	| "completion-supported"
	| "completion-unsupported"
	| "completion-not-claimed";
type CurrentHandoffFacts = {
	closure: (Closure | null)[];
	assurance: (Assurance | null)[];
	authority: ("not-granted" | "granted" | null)[];
	progress: ({ completed: number; total: number } | null)[];
	goal: string[];
	unsupported: string[];
};
export function presentationText(text: string): string {
	return text
		.split("\n")
		.map(presentationLine)
		.filter((line) => line !== null)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}
function presentationLine(raw: string): string | null {
	const line = raw.trim();
	if (/^```\w*$/.test(line)) return null;
	return line
		.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}
function currentLines(text: string): string[] {
	const lines: string[] = [];
	let historical = false;
	for (const raw of text.split("\n")) {
		const line = presentationLine(raw);
		if (!line) continue;
		if (
			/^(?:historical|previous|prior|earlier|superseded)(?:\s+(?:handoff|report|context|reference))?:?$/i.test(
				line,
			)
		) {
			historical = true;
			continue;
		}
		const explicitCurrent =
			/\bcurrent (?:workflow|session|closure|assurance|authority|progress|goal|handoff|delivery|report)\b/i.test(
				line,
			);
		if (/^current(?:\s+(?:handoff|delivery|state|report))?:?$/i.test(line)) {
			historical = false;
			continue;
		}
		if (
			/^(?:historical|previous|prior|earlier|superseded)\b/i.test(line) &&
			!explicitCurrent
		)
			continue;
		if (historical && !explicitCurrent) continue;
		if (explicitCurrent) historical = false;
		lines.push(line);
	}
	return lines;
}
function closureValue(value: string): Closure | null {
	const plain = value.toLowerCase();
	return plain === "complete"
		? "completed"
		: plain === "completed" || plain === "deferred" || plain === "abandoned"
			? plain
			: null;
}
function assuranceValue(value: string): Assurance | null {
	return (
		(
			[
				"completion-supported",
				"completion-unsupported",
				"completion-not-claimed",
			] as const
		).find((item) => item.replaceAll("-", " ") === value.toLowerCase()) ?? null
	);
}
export function currentHandoffFacts(text: string): CurrentHandoffFacts {
	const facts: CurrentHandoffFacts = {
		closure: [],
		assurance: [],
		authority: [],
		progress: [],
		goal: [],
		unsupported: [],
	};
	for (const line of currentLines(text)) {
		const goal = /^(?:current\s+)?goal:\s*(.*)$/i.exec(line);
		if (goal) {
			facts.goal.push(goal[1] ?? "");
			continue;
		}
		for (const segment of line.split(/;|\.\s+(?=[A-Z])/)) {
			const claim = segment.trim().replace(/\.$/, "");
			if (!claim) continue;
			const field =
				/^(?:current\s+)?(closure|assurance|external[- ]action authority|progress):\s*(.*)$/i.exec(
					claim,
				);
			if (field) {
				const value = field[2] ?? "";
				switch (field[1]?.toLowerCase()) {
					case "closure":
						facts.closure.push(
							/^(completed|deferred|abandoned)$/i.test(value)
								? closureValue(value)
								: null,
						);
						break;
					case "assurance":
						facts.assurance.push(assuranceValue(value));
						break;
					case "progress": {
						const progress = /^(\d+) of (\d+) features complete$/i.exec(value);
						facts.progress.push(
							progress
								? { completed: Number(progress[1]), total: Number(progress[2]) }
								: null,
						);
						break;
					}
					default:
						facts.authority.push(
							value.toLowerCase() === "not-granted"
								? "not-granted"
								: value.toLowerCase() === "granted"
									? "granted"
									: null,
						);
				}
				continue;
			}
			if (/^(completed|complete|deferred|abandoned)$/i.test(claim)) {
				facts.closure.push(closureValue(claim));
				continue;
			}
			const closure =
				/^(?:(?:(?:The |This )?(?:current )?(?:Flow )?(?:workflow|session) (?:is |was |has been )|(?:current )?closure (?:is |was ))(completed|complete|deferred|abandoned)(?: and archived)?|(completed|deferred|abandoned) and archived(?: the Flow session)?)$/i.exec(
					claim,
				);
			if (closure) {
				facts.closure.push(closureValue(closure[1] ?? closure[2] ?? ""));
				continue;
			}
			const assurance =
				/^(?:completion (?:is )?)(supported|unsupported|not claimed)(?: by all four assurance checks)?$/i.exec(
					claim,
				);
			if (assurance) {
				facts.assurance.push(assuranceValue(`completion ${assurance[1]}`));
				continue;
			}
			if (
				/^all requirements (?:were |are )?verified, and independent review passed$/i.test(
					claim,
				)
			) {
				facts.assurance.push("completion-supported");
				continue;
			}
			const progress =
				/^(?:Flow handoff:\s*)?(\d+)\s*(?:of|\/)\s*(\d+) features complete$/i.exec(
					claim,
				);
			if (progress) {
				facts.progress.push({
					completed: Number(progress[1]),
					total: Number(progress[2]),
				});
				continue;
			}
			if (
				/^(?:it|the archive|this archive|Flow['’]s archive) does not attest (?:the current workspace|later workspace changes) or grant external[- ]action authority$/i.test(
					claim,
				)
			) {
				facts.authority.push("not-granted");
				continue;
			}
			if (
				/^external[- ]action authority (?:is |has been )?granted$/i.test(claim)
			) {
				facts.authority.push("granted");
				continue;
			}
			if (
				/^(?:you may|authorized to) (?:deploy|publish|release)(?: (?:this )?now)?$/i.test(
					claim,
				)
			) {
				facts.authority.push("granted");
				continue;
			}
			const critical =
				/\b(?:ready to ship|(?:workflow|session) (?:is |was |has been )(?:completed|complete|deferred|abandoned)|(?:you may|authorized to) (?:deploy|publish|release)|current (?:workflow|session|closure|assurance|authority|progress|goal)|external[- ]action authority (?:is|granted)|completion (?:is|supported)|(?:macOS|darwin) (?:validation|proof|evidence) (?:is |was |has been )?(?:passed|verified|exit 0))\b/i.test(
					claim,
				);
			if (critical) facts.unsupported.push(claim);
		}
	}
	return facts;
}
const DISCLOSURES = [
	{
		subject: "Artifact paths and the canonical gate",
		statement:
			"Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.",
		issue:
			"Missing assurance disclosure: caller bindings do not prove completeness or fitness.",
	},
	{
		subject:
			"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance",
		statement:
			"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
		issue:
			"Missing assurance disclosure: coverage and review substance remain model judgments.",
	},
	{
		subject: "Freshness holds when review is accepted",
		statement:
			"Freshness holds when review is accepted; an archive does not attest the current workspace.",
		issue:
			"Missing assurance disclosure: accepted evidence does not attest later workspace changes.",
	},
] as const;
export function missingAssuranceDisclosures(text: string): string[] {
	const lines = currentLines(text).filter(
		(line) => !/^(?:current\s+)?goal:/i.test(line),
	);
	const body = lines.join("\n");
	const issues: string[] = [];
	let subjectConflict = false;
	for (const [index, disclosure] of DISCLOSURES.entries()) {
		const words = disclosure.statement
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			.replace(/ /g, "\\s+");
		const canonicalMatches = [
			...body.matchAll(new RegExp(`(?:^|\\n)${words}(?=$|\\n)`, "g")),
		];
		const canonical = canonicalMatches.length > 0;
		const subjectWords = disclosure.subject
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			.replace(/ /g, "\\s+");
		for (const subject of body.matchAll(
			new RegExp(`(?:^|\\n)${subjectWords}(?=\\s)`, "gi"),
		)) {
			if (
				!canonicalMatches.some((statement) => statement.index === subject.index)
			)
				subjectConflict = true;
		}
		const archiveFreshness =
			index === 2 &&
			lines.some((line) =>
				/(?:^|\. )Flow['’]s archive records the accepted evidence and review; it does not attest later workspace changes or grant external[- ]action authority\.$/i.test(
					line,
				),
			);
		if (!canonical && !archiveFreshness) issues.push(disclosure.issue);
	}
	const opposite = lines.some((line) =>
		/\b(?:caller (?:declarations|bindings) (?:prove|attest) (?:completeness|fitness)|(?:coverage|review substance) (?:is|are) (?:objective proof|proven)|archive (?:does |can )?attest(?:s)? (?:the )?current workspace)\b/i.test(
			line,
		),
	);
	if (opposite || subjectConflict)
		issues.push("Assurance disclosures contain a conflicting current claim.");
	return issues;
}

type FullReportRecord = Readonly<{
	context: string;
	field: string;
	value: string;
}>;
function fullReportRecords(text: string): FullReportRecord[] {
	const records: FullReportRecord[] = [];
	let context = "handoff";
	let feature = "";
	for (const raw of text.split("\n")) {
		const line = presentationLine(raw);
		if (!line) continue;
		if (
			records.length === 0 &&
			/^(?:Full delivery report:?|Here is the full (?:delivery )?report(?: from (?:that|the) close response)?[.:])$/i.test(
				line,
			)
		)
			continue;
		if (/^Features:?$/i.test(line)) {
			context = "features";
			continue;
		}
		if (/^Assurance:?$/i.test(line)) {
			context = "assurance";
			continue;
		}
		if (/^Assurance checks:?$/i.test(line)) {
			context = "checks";
			continue;
		}
		if (/^Assurance limitations:?$/i.test(line)) {
			context = "limitations";
			continue;
		}
		if (/^Reported artifacts:?$/i.test(line)) {
			context = "artifacts";
			continue;
		}
		if (/^Artifacts as reported by Flow /i.test(line)) {
			context = "artifacts";
			records.push({ context, field: "qualification", value: line });
			continue;
		}
		if (/^Findings digest:/i.test(line)) {
			context = "digest";
			const value = line.slice(line.indexOf(":") + 1).trim();
			if (value) records.push({ context, field: "finding", value });
			continue;
		}
		if (/^Observed /i.test(line)) {
			records.push({
				context: "observations",
				field: "observation",
				value: line,
			});
			continue;
		}
		if (context === "features" && /^\S+(?: — .+)?$/.test(line)) {
			feature = line.split(" — ")[0] ?? "";
			context = `feature:${feature}`;
			records.push({ context, field: "identity", value: line });
			continue;
		}
		if (
			context.startsWith("feature:") &&
			/^\S+ — .+$/.test(line) &&
			!/^(?:attempts|latest state|outcome|terminal findings|blocking|advisory):/i.test(
				line,
			)
		) {
			feature = line.split(" — ")[0] ?? "";
			context = `feature:${feature}`;
			records.push({ context, field: "identity", value: line });
			continue;
		}
		const attempt = /^attempts:\s*(.*?);\s*latest state:\s*(.*)$/i.exec(line);
		if (attempt) {
			records.push(
				{ context, field: "attempts", value: attempt[1] ?? "" },
				{ context, field: "latest state", value: attempt[2] ?? "" },
			);
			continue;
		}
		const check =
			/^(satisfied|unsatisfied|not-applicable)\s+(\[[^\]]+\])\s+(?:—\s+)?([^:]+):\s*(.*)$/i.exec(
				line,
			);
		if (check && context === "checks") {
			records.push({
				context,
				field: `${check[1]?.toLowerCase()} ${check[2]} ${check[3]}`,
				value: check[4] ?? "",
			});
			continue;
		}
		const field = /^([^:]+):\s*(.*)$/.exec(line);
		if (field) {
			let key = field[1]?.toLowerCase() ?? "";
			const value = field[2] ?? "";
			if (
				key === "assurance" ||
				(key === "conclusion" && context === "assurance")
			) {
				context = "assurance";
				key = "conclusion";
			}
			if (key === "terminal findings" && !value) {
				context = `feature:${feature}:findings`;
				continue;
			}
			records.push({ context, field: key, value });
			continue;
		}
		records.push({ context, field: "text", value: line });
	}
	return records.sort((a, b) =>
		canonicalJson(a).localeCompare(canonicalJson(b)),
	);
}
export function fullReportMatches(
	text: string,
	report: readonly string[],
): boolean {
	return (
		canonicalJson(fullReportRecords(text)) ===
		canonicalJson(fullReportRecords(report.join("\n")))
	);
}
