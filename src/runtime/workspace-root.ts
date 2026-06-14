import { homedir } from "node:os";
import { delimiter, isAbsolute, parse, resolve } from "node:path";

declare const mutableWorkspaceRootBrand: unique symbol;

export type MutableWorkspaceRoot = string & {
	readonly [mutableWorkspaceRootBrand]: "MutableWorkspaceRoot";
};

type MutableWorkspaceRootDetails = {
	root: string | null;
	trusted: boolean;
	rejectionReason: string | null;
	source?: string | null;
	mutationAllowed?: boolean;
	usedFallback?: boolean;
};

// FLOW_TRUSTED_WORKSPACE_ROOTS is advisory only: the resulting `trusted` flag
// is surfaced in doctor diagnostics and the workspace guidance message, but it
// does NOT gate any mutation. The only behavioral guards are the $HOME check in
// suspiciousWorkspaceReason and the ask-prompt in mutable-workspace-permission.
const TRUSTED_WORKSPACE_ROOTS_ENV = "FLOW_TRUSTED_WORKSPACE_ROOTS";

export class InvalidFlowWorkspaceRootError extends Error {
	readonly code = "INVALID_FLOW_WORKSPACE_ROOT";
	readonly summary: string;
	readonly remediation: string | null;
	readonly details: MutableWorkspaceRootDetails;

	constructor({
		summary,
		remediation,
		details,
	}: {
		summary: string;
		remediation?: string | null;
		details: MutableWorkspaceRootDetails;
	}) {
		super(summary);
		this.name = "InvalidFlowWorkspaceRootError";
		this.summary = summary;
		this.remediation = remediation ?? null;
		this.details = details;
	}
}

export function normalizeWorkspaceRoot(
	rawPath: string | undefined,
): string | null {
	const path = rawPath?.trim();
	if (!path) {
		return null;
	}

	const normalized = resolve(path);
	if (parse(normalized).root === normalized) {
		return null;
	}

	return normalized;
}

function getTrustedWorkspaceRoots(): Set<string> {
	const configured = process.env[TRUSTED_WORKSPACE_ROOTS_ENV]?.trim();
	if (!configured) {
		return new Set();
	}

	const trusted = new Set<string>();
	for (const entry of configured.split(delimiter)) {
		const next = entry.trim();
		if (!next || !isAbsolute(next)) {
			continue;
		}
		trusted.add(resolve(next));
	}

	return trusted;
}

function suspiciousWorkspaceReason(root: string): string | null {
	// The only hard runtime rejection here is using $HOME itself as a mutable
	// root. Hidden roots *under* $HOME (e.g. a `~/.something` workspace) are
	// intentionally allowed at this layer — approval for them is gated at the
	// tool-surface ask-prompt (mutable-workspace-permission.ts), which fails
	// closed when the host cannot prompt. See workspace-root-guard.test.ts.
	const normalizedHome = resolve(process.env.HOME ?? homedir());
	if (root === normalizedHome) {
		return "Flow blocks using your home directory itself as a mutable workspace root.";
	}

	return null;
}

export function inspectMutableWorkspaceRoot(
	rawPath: string | undefined,
): MutableWorkspaceRootDetails {
	const root = normalizeWorkspaceRoot(rawPath);
	if (!root) {
		return {
			root: null,
			trusted: false,
			rejectionReason:
				"Flow requires a non-root workspace path for mutable session operations.",
		};
	}

	const trusted = getTrustedWorkspaceRoots().has(root);
	return {
		root,
		trusted,
		rejectionReason: suspiciousWorkspaceReason(root),
	};
}

export function assertMutableWorkspaceRoot(
	rawPath: string,
): MutableWorkspaceRoot {
	const details = inspectMutableWorkspaceRoot(rawPath);
	if (details.root && !details.rejectionReason) {
		return details.root as MutableWorkspaceRoot;
	}

	const rootLabel = details.root
		? `'${details.root}'`
		: "from the provided path";
	throw new InvalidFlowWorkspaceRootError({
		summary: `Flow blocked mutable workspace root ${rootLabel}: ${details.rejectionReason ?? "missing or root-like path."}`,
		remediation: details.root
			? "Choose a project/worktree subdirectory instead of using $HOME directly so Flow can manage .flow state there."
			: "Provide a non-root project/worktree directory so Flow can manage .flow state there.",
		details,
	});
}
