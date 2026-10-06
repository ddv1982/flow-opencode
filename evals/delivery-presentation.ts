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
	auxiliaryCounts: {
		kind: "unfinished" | "blocking" | "advisory";
		count: number;
	}[];
	assuranceCheckClaims: { count: number; status: "satisfied" }[];
	unavailableProofPlatforms: string[];
	observations: {
		command: string;
		exitCode: number | null;
		unchangedInvocation: boolean;
		qualification:
			| "observation"
			| "does-not-claim-pass"
			| "claimed-pass"
			| null;
	}[];
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
function countValue(value: string): number | null {
	const words: Readonly<Record<string, number>> = {
		zero: 0,
		one: 1,
		two: 2,
		three: 3,
		four: 4,
		five: 5,
		six: 6,
	};
	const count = /^\d+$/.test(value)
		? Number(value)
		: words[value.toLowerCase()];
	return count !== undefined && Number.isSafeInteger(count) && count >= 0
		? count
		: null;
}
type AuxiliaryCount = {
	kind: "unfinished" | "blocking" | "advisory";
	count: number;
};
function auxiliaryCounts(value: string): AuxiliaryCount[] | null {
	if (/^none unfinished$/i.test(value))
		return [{ kind: "unfinished", count: 0 }];
	const kinds = new Map<string, AuxiliaryCount["kind"]>([
		["unfinished", "unfinished"],
		["unfinished features", "unfinished"],
		["blockers", "blocking"],
		["advisory findings", "advisory"],
	]);
	if (/^no /i.test(value)) {
		const nouns = value
			.slice(3)
			.toLowerCase()
			.split(/ (?:and|or) /);
		const counts = nouns.map((noun) => {
			const kind = kinds.get(noun);
			return kind ? { kind, count: 0 } : null;
		});
		return counts.every((count) => count !== null) ? counts : null;
	}
	const match =
		/^(no|\d+|zero|one|two|three|four|five|six) (unfinished(?: features)?|blockers|advisory findings)$/i.exec(
			value,
		);
	if (!match) return null;
	const count =
		match[1]?.toLowerCase() === "no" ? 0 : countValue(match[1] ?? "");
	if (count === null) return null;
	return [
		{
			kind: match[2]?.toLowerCase().startsWith("unfinished")
				? "unfinished"
				: match[2]?.toLowerCase() === "blockers"
					? "blocking"
					: "advisory",
			count,
		},
	];
}
function progressValue(value: string) {
	const match = /^(\d+)\s*(?:of|\/)\s*(\d+) features complete(.*)$/i.exec(
		value,
	);
	if (!match) return undefined;
	const completed = countValue(match[1] ?? "");
	const total = countValue(match[2] ?? "");
	if (completed === null || total === null) return null;
	const tail = match[3] ?? "";
	if (tail && !/^,\s*/.test(tail)) return null;
	const counts: AuxiliaryCount[] = [];
	for (const clause of tail
		.replace(/^,\s*/, "")
		.split(/,\s*/)
		.filter(Boolean)) {
		const parsed = auxiliaryCounts(clause);
		if (!parsed) return null;
		counts.push(...parsed);
	}
	return { progress: { completed, total }, counts };
}
function authorityValue(value: string): "not-granted" | "granted" | null {
	const plain = value.toLowerCase();
	return plain === "not granted" || plain === "not-granted"
		? "not-granted"
		: plain === "granted"
			? "granted"
			: null;
}
function assuranceValue(
	value: string,
): { conclusion: Assurance; checkCount: number | null } | null {
	const match =
		/^(?:completion (?:is )?)?(supported|unsupported|not claimed)(?:(?: by all (\w+) (?:assurance )?checks)|(?:, with all (\w+) (?:assurance )?checks satisfied))?$/i.exec(
			value,
		);
	if (!match) return null;
	const conclusion = (
		[
			"completion-supported",
			"completion-unsupported",
			"completion-not-claimed",
		] as const
	).find(
		(item) =>
			item.slice("completion-".length).replaceAll("-", " ") ===
			match[1]?.toLowerCase(),
	);
	const rawCount = match[2] ?? match[3];
	const checkCount = rawCount === undefined ? null : countValue(rawCount);
	if (
		!conclusion ||
		(rawCount !== undefined &&
			(checkCount === null || conclusion !== "completion-supported"))
	)
		return null;
	return { conclusion, checkCount };
}
function closureStatement(
	value: string,
): { closure: Closure; unavailablePlatform: string | null } | null {
	const match =
		/^(completed|deferred|abandoned)(?: and archived)?(?: because (macOS|darwin|Linux|Windows) validation is unavailable)?$/i.exec(
			value,
		);
	if (!match) return null;
	const closure = closureValue(match[1] ?? "");
	const platform = match[2]?.toLowerCase();
	if (!closure || (platform && closure !== "deferred")) return null;
	return {
		closure,
		unavailablePlatform:
			platform === "macos"
				? "darwin"
				: platform === "windows"
					? "win32"
					: (platform ?? null),
	};
}
function commandResultValue(line: string, commands: readonly string[]) {
	for (const command of commands) {
		const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const prefix = new RegExp(
			`^(?:Observed )?["']?${escaped}["']?(?=[:\\s]|$)(.*)$`,
		);
		const candidates = [line, line.replace(/^[^:]+:\s*/, "")];
		const matched = candidates
			.map((candidate) => prefix.exec(candidate))
			.find((value) => value !== null);
		if (!matched) continue;
		const body = (matched[1] ?? "")
			.trim()
			.replace(/^(?::\s*|[—–]\s*|-\s+)/, "");
		const invalid = {
			command,
			exitCode: null,
			qualification: null,
			unchangedInvocation: false,
		};
		if (
			!/\b(?:exit|exited|passed|succeeded|recorded as an observation)\b/i.test(
				body,
			)
		)
			continue;
		if (commands.some((other) => body.includes(other))) return invalid;
		const parts = body
			.split(/;|\.\s+(?=[A-Z])/)
			.map((part) => part.trim().replace(/\.$/, ""));
		const status = parts.shift() ?? "";
		const value =
			/^(?:(passed)(?:,\s*| with )|(recorded as an observation),\s*)?(?:exited|exit(?: code)?)\s+(-?\d+|unavailable)(.*)$/i.exec(
				status,
			);
		if (!value) return invalid;
		const rawExit = value[3] ?? "";
		const exitCode =
			rawExit.toLowerCase() === "unavailable" ? null : Number(rawExit);
		if (exitCode !== null && !Number.isSafeInteger(exitCode)) return invalid;
		const malformed = {
			command,
			exitCode,
			qualification: null,
			unchangedInvocation: false,
		};
		const metadata = value[4] ?? "";
		if (
			metadata &&
			!/^(?:, (?:host|source|output|report) .+|, reporting \d+ [A-Za-z ]+)$/i.test(
				metadata,
			)
		)
			return malformed;
		if (/\b(?:passed|succeeded|granted|complete|completion)\b/i.test(metadata))
			return malformed;
		let qualification:
			| "observation"
			| "does-not-claim-pass"
			| "claimed-pass"
			| null = value[1] ? "claimed-pass" : value[2] ? "observation" : null;
		let unchangedInvocation = false;
		for (const qualifier of parts) {
			if (
				/^(?:this observation does not claim a pass|this does not claim the command passed)$/i.test(
					qualifier,
				)
			) {
				if (qualification !== "claimed-pass")
					qualification = "does-not-claim-pass";
			} else if (
				/^(?:this (?:command|observation)|it) (?:passed|succeeded)$/i.test(
					qualifier,
				)
			)
				qualification = "claimed-pass";
			else if (
				qualification === "claimed-pass" &&
				/^Its script and invocation are unchanged$/i.test(qualifier)
			)
				unchangedInvocation = true;
			else return malformed;
		}
		return { command, exitCode, qualification, unchangedInvocation };
	}
	return null;
}
export function currentHandoffFacts(
	text: string,
	observationCommands: readonly string[] = [],
): CurrentHandoffFacts {
	const facts: CurrentHandoffFacts = {
		closure: [],
		assurance: [],
		authority: [],
		progress: [],
		goal: [],
		auxiliaryCounts: [],
		assuranceCheckClaims: [],
		unavailableProofPlatforms: [],
		observations: [],
		unsupported: [],
	};
	for (const line of currentLines(text)) {
		const goal = /^(?:current\s+)?goal:\s*(.*)$/i.exec(line);
		if (goal) {
			facts.goal.push(goal[1] ?? "");
			continue;
		}
		const observation = commandResultValue(line, observationCommands);
		if (observation) {
			facts.observations.push(observation);
			if (observation.qualification === null) facts.unsupported.push(line);
		} else if (
			/^(?:[^:]+:\s*)?(?:node|bun) \S+[^;]*\bpassed(?:,\s*| with )exit(?: code)? -?\d+\b/i.test(
				line,
			)
		) {
			facts.unsupported.push(line);
		}
		for (const segment of line.split(/;|\.\s+(?=[A-Z])/)) {
			const claim = segment.trim().replace(/\.$/, "");
			if (!claim) continue;
			const compound = observation
				? null
				: /^(.+?)\s+[—–]\s+(\d+\s*(?:of|\/)\s*\d+\s+features\b.*)$/i.exec(
						claim,
					);
			if (compound) {
				const closure = closureStatement(compound[1] ?? "");
				const progress = progressValue(compound[2] ?? "");
				facts.closure.push(closure?.closure ?? null);
				facts.progress.push(progress?.progress ?? null);
				if (!closure || !progress) facts.unsupported.push(claim);
				if (closure?.unavailablePlatform)
					facts.unavailableProofPlatforms.push(closure.unavailablePlatform);
				if (progress) facts.auxiliaryCounts.push(...progress.counts);
				continue;
			}
			const field =
				/^(?:(?:current|Flow)\s+)?(closure|flow|assurance|external[- ]action authority|progress):\s*(.*)$/i.exec(
					claim,
				);
			if (field) {
				const value = field[2] ?? "";
				switch (field[1]?.toLowerCase()) {
					case "flow":
					case "closure": {
						const parsed = closureStatement(value);
						facts.closure.push(parsed?.closure ?? null);
						if (parsed?.unavailablePlatform)
							facts.unavailableProofPlatforms.push(parsed.unavailablePlatform);
						break;
					}
					case "assurance": {
						const parsed = assuranceValue(value);
						facts.assurance.push(parsed?.conclusion ?? null);
						if (parsed?.checkCount !== null && parsed?.checkCount !== undefined)
							facts.assuranceCheckClaims.push({
								count: parsed.checkCount,
								status: "satisfied",
							});
						break;
					}
					case "progress": {
						const parsed = progressValue(value);
						facts.progress.push(parsed?.progress ?? null);
						if (parsed) facts.auxiliaryCounts.push(...parsed.counts);
						break;
					}
					default:
						facts.authority.push(authorityValue(value));
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
			if (/^completion /i.test(claim)) {
				const parsed = assuranceValue(claim);
				facts.assurance.push(parsed?.conclusion ?? null);
				if (parsed?.checkCount !== null && parsed?.checkCount !== undefined)
					facts.assuranceCheckClaims.push({
						count: parsed.checkCount,
						status: "satisfied",
					});
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
			const progress = progressValue(claim.replace(/^Flow handoff:\s*/i, ""));
			if (progress !== undefined) {
				facts.progress.push(progress?.progress ?? null);
				if (progress) facts.auxiliaryCounts.push(...progress.counts);
				continue;
			}
			if (/^all \w+ assurance checks\b/i.test(claim)) {
				const checks = /^all (\w+) assurance checks satisfied$/i.exec(claim);
				const count = checks ? countValue(checks[1] ?? "") : null;
				if (count === null) facts.unsupported.push(claim);
				else facts.assuranceCheckClaims.push({ count, status: "satisfied" });
				continue;
			}
			const counts = auxiliaryCounts(claim);
			if (counts) {
				facts.auxiliaryCounts.push(...counts);
				continue;
			}
			const authority =
				/^external[- ]action authority(?: is| has been)? (.+)$/i.exec(claim);
			if (authority) {
				facts.authority.push(authorityValue(authority[1] ?? ""));
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
