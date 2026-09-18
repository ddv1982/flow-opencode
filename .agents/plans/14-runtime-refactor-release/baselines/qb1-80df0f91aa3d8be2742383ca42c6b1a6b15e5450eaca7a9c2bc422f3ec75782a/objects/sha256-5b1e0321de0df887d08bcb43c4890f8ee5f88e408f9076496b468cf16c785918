import { createHash } from "node:crypto";
import { MAX_DECLARED_ASSERTIONS, MAX_TEXT_BYTES } from "./limits.js";
import type { Plan, SourceDigest } from "./session.js";

export type RequestEvidenceAnchor = Readonly<{
	requestSha256: SourceDigest;
	hostSessionSha256: SourceDigest;
	assertions: string[];
}>;
export type RequestAuthority = Readonly<{
	hostSessionSha256: SourceDigest;
}>;

function digest(domain: string, value: string): SourceDigest {
	return `sha256:${createHash("sha256").update(`${domain}\0${value}`).digest("hex")}`;
}

export function requestAuthority(hostSessionId: string): RequestAuthority {
	return { hostSessionSha256: digest("flow-host-session-v1", hostSessionId) };
}

export function requestEvidenceAnchor(
	request: string,
	hostSessionId: string,
): RequestEvidenceAnchor | null {
	const assertions = extractExplicitRequestAssertions(request);
	return assertions.length === 0
		? null
		: {
				requestSha256: digest("flow-request-evidence-v1", request),
				hostSessionSha256: requestAuthority(hostSessionId).hostSessionSha256,
				assertions,
			};
}

const NAMED =
	/\b(?:test(?:\s+case)?|acceptance\s+case|case|assertion)\s+named\s+(?:`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)')/giu;

export function extractExplicitRequestAssertions(request: string): string[] {
	const assertions = [
		...new Set(
			[...request.matchAll(NAMED)].flatMap((match) => {
				const name = (match[1] ?? match[2] ?? match[3] ?? "").trim();
				if (Buffer.byteLength(name, "utf8") > MAX_TEXT_BYTES)
					throw new Error(
						`Named acceptance assertion exceeds ${MAX_TEXT_BYTES} bytes.`,
					);
				return name ? [name] : [];
			}),
		),
	];
	if (assertions.length > MAX_DECLARED_ASSERTIONS)
		throw new Error(
			`A request may name at most ${MAX_DECLARED_ASSERTIONS} acceptance assertions.`,
		);
	return assertions;
}

export function missingRequestAssertions(
	plan: Plan,
	required: readonly string[],
): string[] {
	const declared = new Set(
		(plan.evidence ?? []).flatMap((entry) => entry.assertions ?? []),
	);
	return required.filter((name) => !declared.has(name));
}
