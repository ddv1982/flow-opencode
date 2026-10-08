import { canonicalJson } from "./canonical-json.js";

type Closure = "completed" | "deferred" | "abandoned";
type Assurance =
	| "completion-supported"
	| "completion-unsupported"
	| "completion-not-claimed";
type CommandIntegrity =
	| "not-claimed"
	| "script-unchanged"
	| "script-and-invocation-unchanged";
type CommandObservation = {
	command: string;
	exitCode: number | null;
	integrity: CommandIntegrity;
	qualification: "observation" | "does-not-claim-pass" | "claimed-pass" | null;
};
function commandIntegrityValue(
	clause: string,
): Exclude<CommandIntegrity, "not-claimed"> | null {
	if (/^the script (?:is|was|remains|remained) unchanged$/i.test(clause))
		return "script-unchanged";
	const match =
		/^its (script|invocation|command)(?: and (script|invocation|command))? (is|was|remains|remained|are|were|remain) unchanged$/i.exec(
			clause,
		);
	if (!match) return null;
	const subjects = [match[1], match[2]]
		.filter((subject): subject is string => subject !== undefined)
		.map((subject) => subject.toLowerCase());
	const singular = ["is", "was", "remains", "remained"].includes(
		(match[3] ?? "").toLowerCase(),
	);
	if (
		singular !== (subjects.length === 1) ||
		new Set(subjects).size !== subjects.length ||
		!subjects.includes("script")
	)
		return null;
	return subjects.length === 1
		? "script-unchanged"
		: "script-and-invocation-unchanged";
}
type CurrentHandoffFacts = {
	closure: (Closure | null)[];
	assurance: (Assurance | null)[];
	authority: ("not-granted" | "granted" | null)[];
	progress: ({ completed: number; total: number } | null)[];
	goal: string[];
	auxiliaryCounts: AuxiliaryCount[];
	assuranceCheckClaims: { count: number; status: "satisfied" }[];
	unavailableProofPlatforms: string[];
	unavailableCommands: {
		command: string;
		targetPlatform: string;
		hostPlatform: string;
	}[];
	independentReview: (
		| { kind: "passed"; findings: "none" | "not-claimed" }
		| { kind: "not-performed" }
		| null
	)[];
	observations: CommandObservation[];
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
	kind: "unfinished" | "blocked-feature" | "blocking" | "advisory";
	count: number;
};
function auxiliaryCounts(
	value: string,
	featureScope = false,
): AuxiliaryCount[] | null {
	const match = /^(none|no|zero|one|two|three|four|five|six|\d+) (.+)$/i.exec(
		value,
	);
	if (!match) return null;
	const count = /^(none|no)$/i.test(match[1] ?? "")
		? 0
		: countValue(match[1] ?? "");
	if (count === null) return null;
	const nouns = (match[2] ?? "").toLowerCase().split(/ (?:and|or) /);
	if (nouns.length > 1 && count !== 0) return null;
	const kinds = new Map<string, AuxiliaryCount["kind"]>([
		["unfinished", "unfinished"],
		["unfinished features", "unfinished"],
		["blocked features", "blocked-feature"],
		["blockers", "blocking"],
		["advisory findings", "advisory"],
	]);
	if (featureScope && count === 0) kinds.set("blocked", "blocked-feature");
	const claims = nouns.map((noun) => {
		const kind = kinds.get(noun);
		return kind ? { kind, count } : null;
	});
	return claims.every((claim) => claim !== null) ? claims : null;
}
function progressValue(value: string) {
	const match = /^(\d+)\s*(?:of|\/)\s*(\d+) features complete(.*)$/i.exec(
		value,
	);
	if (!match) return null;
	const completed = countValue(match[1] ?? "");
	const total = countValue(match[2] ?? "");
	if (completed === null || total === null) return null;
	const tail = match[3] ?? "";
	if (tail && !/^,\s*\S/.test(tail)) return null;
	const counts: AuxiliaryCount[] = [];
	if (tail)
		for (const clause of tail.replace(/^,\s*/, "").split(/,\s*/)) {
			const parsed = auxiliaryCounts(clause, true);
			if (!parsed) return null;
			counts.push(...parsed);
		}
	return { progress: { completed, total }, counts };
}
type HandoffRecord = {
	closure?: Closure | null;
	progress?: { completed: number; total: number } | null;
	counts: AuxiliaryCount[];
	unavailablePlatform: string | null;
	invalid: boolean;
};
const CLOSURE_SUBJECT =
	/\b(?:(?:The |This )?(?:current )?(?:Flow )?(?:workflow|session)|(?:current )?closure)\s+(?=(?:(?:is|was|has(?: not)? been|isn['’]t|wasn['’]t|hasn['’]t been|(?:won|couldn|shouldn)['’]t be|(?:can|could|may|might|must|should|will|would)(?: not)?(?: have been| be))\s+)?(?:not\s+)?(?:completed|complete|deferred|abandoned)\b)/i;
function closureProgressValue(claim: string): HandoffRecord | null {
	const heading =
		/^(?:(?:current|Flow)\s+)?(closure|flow|progress):\s*(.*)$/i.exec(claim);
	const body = heading
		? (heading[2] ?? "")
		: claim.replace(/^Flow handoff:\s*/i, "");
	const progressOnly =
		heading?.[1]?.toLowerCase() === "progress" ||
		(!heading && /^\d+\s*(?:of|\/)\s*\d+\s+features\b/i.test(body));
	if (progressOnly) {
		const parsed = progressValue(body);
		return {
			progress: parsed?.progress ?? null,
			counts: parsed?.counts ?? [],
			unavailablePlatform: null,
			invalid: !parsed,
		};
	}
	const candidateSubject = CLOSURE_SUBJECT.exec(body);
	const subject = candidateSubject?.index === 0 ? candidateSubject : null;
	const terminal =
		/^(?:completed|complete|deferred|abandoned)(?:$| and archived\b)/i.test(
			body,
		);
	const compound =
		/^[^"']+?(?::\s*|\s+[—–]\s+)\d+\s*(?:of|\/)\s*\d+\s+features\b/i.test(body);
	if (!heading && !subject && !terminal && !compound) return null;
	const rest = subject
		? body.slice(subject[0].length).replace(/^(?:is |was |has been )/i, "")
		: body;
	const joined = /^(.+?)(?::\s*|\s+[—–]\s+)(.*)$/i.exec(rest);
	const closure = closureStatement(joined?.[1] ?? rest);
	const progress = joined ? progressValue(joined[2] ?? "") : null;
	const valid = !!closure && (!joined || !!progress);
	return {
		closure: valid ? closure.closure : null,
		...(joined
			? { progress: valid ? (progress?.progress ?? null) : null }
			: {}),
		counts: valid ? (progress?.counts ?? []) : [],
		unavailablePlatform: valid ? closure.unavailablePlatform : null,
		invalid: !valid,
	};
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
		/^(completed|complete|deferred|abandoned)(?: and archived(?: (?:the |this )?(?:current )?(?:Flow )?(?:session|workflow))?)?(?: because (macOS|darwin|Linux|Windows) validation is unavailable)?$/i.exec(
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
function commandStatusAssertion(text: string): boolean {
	return /^(?:(?:(?:the|this) )?(?:command|observation)|it)\b[^.!?]*\b(?:pass(?:ed)?|succeed(?:ed)?|fail(?:ed)?|exit(?:ed)?|unavailable)\b/i.test(
		text,
	);
}
function platformValue(value: string) {
	const lower = value.toLowerCase();
	return lower === "macos" ? "darwin" : lower === "windows" ? "win32" : lower;
}
function sentenceBoundary(text: string, start = 0) {
	let quote: string | null = null;
	for (let index = start; index < text.length; index++) {
		const character = text[index];
		if (character === "\\") {
			index++;
			continue;
		}
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") {
			if (
				character === "'" &&
				/[A-Za-z]/.test(text[index - 1] ?? "") &&
				/[A-Za-z]/.test(text[index + 1] ?? "")
			)
				continue;
			quote = character;
			continue;
		}
		if (character === "." && /^\s+[A-Za-z0-9]/.test(text.slice(index + 1)))
			return { end: index + 1, unterminatedQuote: false };
	}
	return { end: text.length, unterminatedQuote: quote !== null };
}
function commandResultValue(line: string, commands: readonly string[]) {
	if (/^Example:/i.test(line)) return null;
	for (const command of [...commands].sort((a, b) => b.length - a.length)) {
		const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const prefix = new RegExp(
			`^(?:Observed )?["']?${escaped}["']?(?=[:\\s]|$)(.*)$`,
		);
		const candidates = [line, line.replace(/^[^:]+:\s*/, "")];
		const matched = candidates
			.map((candidate) => prefix.exec(candidate))
			.find((value) => value !== null);
		if (!matched) continue;
		const rawBody = matched[1] ?? "";
		const availability =
			/^ on (macOS|darwin|Linux|Windows); unavailable on this (macOS|darwin|Linux|Windows) host\.?$/i.exec(
				rawBody,
			);
		if (availability)
			return {
				observation: null,
				unavailable: {
					command,
					targetPlatform: platformValue(availability[1] ?? ""),
					hostPlatform: platformValue(availability[2] ?? ""),
				},
				remainder: "",
				source: line,
			};
		let boundary = sentenceBoundary(rawBody);
		while (
			boundary.end < rawBody.length &&
			(commandStatusAssertion(rawBody.slice(boundary.end).trimStart()) ||
				/^(?:this (?:(?:command|observation)|does not claim the command passed)|it|its|the (?:script|invocation))\b/i.test(
					rawBody.slice(boundary.end).trimStart(),
				))
		) {
			boundary = sentenceBoundary(rawBody, boundary.end);
		}
		const remainderStart = boundary.end;
		const record = rawBody.slice(0, remainderStart);
		const remainder = rawBody.slice(remainderStart).trim();
		if (
			/^Outstanding proof:/i.test(line) &&
			/^\s+on (?:macOS|darwin|Linux|Windows)\.?\s*$/i.test(record)
		)
			return {
				observation: null,
				remainder,
				source: line
					.slice(0, line.length - rawBody.length + remainderStart)
					.trim(),
			};
		const parsed = parseCommandResult(
			record,
			command,
			commands,
			boundary.unterminatedQuote,
		);
		return {
			observation: parsed,
			remainder,
			source: line
				.slice(0, line.length - rawBody.length + remainderStart)
				.trim(),
		};
	}
	return null;
}
function proseGateClause(line: string) {
	const leading = /^the Linux gate ((?:node|bun) .+)$/i.exec(line);
	if (leading) return { prefix: null, commandClause: leading[1] ?? "" };
	if (/^Example:/i.test(line)) return null;
	let quote: string | null = null;
	for (let index = 0; index < line.length; index++) {
		const character = line[index];
		if (character === "\\") {
			index++;
			continue;
		}
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") {
			if (
				character === "'" &&
				/[\p{L}\p{N}\p{M}_]$/u.test(line.slice(0, index))
			)
				continue;
			quote = character;
			continue;
		}
		if (character !== ",") continue;
		const conjunction = /^, and the Linux gate ((?:node|bun) .+)$/i.exec(
			line.slice(index),
		);
		if (conjunction)
			return {
				prefix: line.slice(0, index).trim() || null,
				commandClause: conjunction[1] ?? "",
			};
	}
	return null;
}
function parseCommandResult(
	rawBody: string,
	command: string,
	commands: readonly string[],
	unterminatedQuote: boolean,
) {
	const body = rawBody.trim().replace(/^(?::\s*|[—–]\s*|-\s+)/, "");
	const invalid: CommandObservation = {
		command,
		exitCode: null,
		qualification: null,
		integrity: "not-claimed",
	};
	if (unterminatedQuote) return invalid;
	if (commands.some((other) => body.includes(other))) return invalid;
	const parts = body
		.split(/;|\.\s+(?=[A-Za-z])/)
		.map((part) => part.trim().replace(/\.$/, ""));
	const status = parts.shift() ?? "";
	const value =
		/^(?:(passed)(?:,\s*| with )|(recorded as an observation),\s*)?(?:exited|exit(?: code)?)\s+(-?\d+|unavailable)(.*)$/i.exec(
			status,
		);
	const barePass = /^passed$/i.test(status);
	if (!value && !barePass) return invalid;
	const rawExit = barePass ? "0" : (value?.[3] ?? "");
	const exitCode =
		rawExit.toLowerCase() === "unavailable" ? null : Number(rawExit);
	if (exitCode !== null && !Number.isSafeInteger(exitCode)) return invalid;
	const malformed: CommandObservation = {
		command,
		exitCode,
		qualification: null,
		integrity: "not-claimed",
	};
	const metadata = value?.[4] ?? "";
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
		| null =
		barePass || value?.[1] ? "claimed-pass" : value?.[2] ? "observation" : null;
	let integrity: CommandIntegrity = "not-claimed";
	for (const qualifier of parts) {
		if (
			/^(?:this observation does not claim a pass|this does not claim the command passed)$/i.test(
				qualifier,
			)
		) {
			if (qualification === "claimed-pass") return malformed;
			qualification = "does-not-claim-pass";
		} else if (
			/^(?:this (?:command|observation)|it) (?:passed|succeeded)$/i.test(
				qualifier,
			)
		) {
			if (
				qualification === "observation" ||
				qualification === "does-not-claim-pass"
			)
				return malformed;
			qualification = "claimed-pass";
		} else {
			const claim = commandIntegrityValue(qualifier);
			if (
				!claim ||
				(claim === "script-and-invocation-unchanged" &&
					qualification !== "claimed-pass")
			)
				return malformed;
			if (
				integrity === "not-claimed" ||
				claim === "script-and-invocation-unchanged"
			)
				integrity = claim;
		}
	}
	return { command, exitCode, qualification, integrity };
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
		unavailableCommands: [],
		independentReview: [],
		observations: [],
		unsupported: [],
	};
	const pending = currentLines(text);
	for (let index = 0; index < pending.length; index++) {
		let line = pending[index] ?? "";
		const goal = /^(?:current\s+)?goal:\s*(.*)$/i.exec(line);
		if (goal) {
			facts.goal.push(goal[1] ?? "");
			continue;
		}
		const commandRecord = commandResultValue(line, observationCommands);
		if (commandRecord) {
			if ("unavailable" in commandRecord && commandRecord.unavailable)
				facts.unavailableCommands.push(commandRecord.unavailable);
			if (commandRecord.observation) {
				facts.observations.push(commandRecord.observation);
				if (commandRecord.observation.qualification === null)
					facts.unsupported.push(commandRecord.source);
			}
			if (commandRecord.remainder)
				pending.splice(index + 1, 0, commandRecord.remainder);
			continue;
		}
		const gate = proseGateClause(line);
		if (gate) {
			pending.splice(
				index,
				1,
				...(gate.prefix
					? [gate.prefix, gate.commandClause]
					: [gate.commandClause]),
			);
			index--;
			continue;
		}
		const boundary = sentenceBoundary(line);
		if (boundary.end < line.length) {
			pending.splice(index + 1, 0, line.slice(boundary.end).trim());
			line = line.slice(0, boundary.end);
		}
		if (
			!/^Example:/i.test(line) &&
			(/^(?:[^:]+:\s*)?(?:node|bun) \S+[^;]*\bpassed(?:,\s*| with )exit(?: code)? -?\d+\b/i.test(
				line,
			) ||
				/^(?:[^:]+:\s*)?(?:node|bun) \S+[^;]*\s+passed(?:[.;]|$)/i.test(line))
		) {
			facts.unsupported.push(line);
		}
		if (/^(?:[^:]+:\s*)?(?:node|bun) \S+.*\bunavailable\b/i.test(line))
			facts.unsupported.push(line);
		for (const segment of line.split(/;|\.\s+(?=[A-Z])/)) {
			const claim = segment.trim().replace(/\.$/, "");
			if (!claim) continue;
			if (/^No independent review or completion is claimed$/i.test(claim)) {
				facts.assurance.push("completion-not-claimed");
				continue;
			}
			const review = /^Independent review(?::|\s)\s*(.*)$/i.exec(claim);
			if (review) {
				const value = review[1] ?? "";
				facts.independentReview.push(
					/^(?:was )?not performed$/i.test(value)
						? { kind: "not-performed" }
						: /^(?:has |was )?(?:passed|passed with no findings)$/i.test(value)
							? {
									kind: "passed",
									findings: /with no findings$/i.test(value)
										? "none"
										: "not-claimed",
								}
							: null,
				);
				if (facts.independentReview.at(-1) === null)
					facts.unsupported.push(claim);
				continue;
			}
			const handoff = closureProgressValue(claim);
			if (handoff) {
				if ("closure" in handoff) facts.closure.push(handoff.closure ?? null);
				if ("progress" in handoff)
					facts.progress.push(handoff.progress ?? null);
				facts.auxiliaryCounts.push(...handoff.counts);
				if (handoff.unavailablePlatform)
					facts.unavailableProofPlatforms.push(handoff.unavailablePlatform);
				if (handoff.invalid) facts.unsupported.push(claim);
				continue;
			}
			const field =
				/^(?:(?:current|Flow)\s+)?(assurance|external[- ]action authority):\s*(.*)$/i.exec(
					claim,
				);
			if (field) {
				const value = field[2] ?? "";
				switch (field[1]?.toLowerCase()) {
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
					default:
						facts.authority.push(authorityValue(value));
				}
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
				/^external[- ]action authority(?: is| was| has been)? (.+)$/i.exec(
					claim,
				);
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
				commandStatusAssertion(claim) ||
				CLOSURE_SUBJECT.test(claim) ||
				/\bprogress (?:is |was |has been )?(?:incomplete|unfinished|blocked|not complete)\b/i.test(
					claim,
				) ||
				/\b(?:closure|progress):|\b\d+\s*(?:of|\/)\s*\d+\s+features\b/i.test(
					claim,
				) ||
				/\b(?:ready to ship|(?:you may|authorized to) (?:deploy|publish|release)|current (?:workflow|session|closure|assurance|authority|progress|goal)|external[- ]action authority|completion (?:is|supported)|(?:macOS|darwin) (?:validation|proof|evidence) (?:is |was |has been )?(?:passed|verified|exit 0))\b/i.test(
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
			...body.matchAll(
				new RegExp(
					`(?:^|\\n)${index === 2 ? words.replace("an\\s+archive", "(?:an|the)\\s+archive") : words}(?=$|\\n)`,
					"g",
				),
			),
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
