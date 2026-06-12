import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
	assertDescendant,
	getActiveSessionsDir,
	getCompletedSessionDir,
	getCompletedSessionsDir,
	getFeatureDocPathFromSessionDir,
	getSessionDir,
	getSessionPath,
	getSessionPathFromDir,
	getStoredSessionsDir,
	InvalidFlowPathInputError,
	type LiveSessionLocation,
} from "./paths";

export type FeatureDocSessionLocation = LiveSessionLocation | "completed";

export type FeatureDocDrilldownAvailability =
	| "available"
	| "missing_session_root"
	| "missing_feature_doc";

export type FeatureDocDrilldownTarget = {
	kind: "feature_doc";
	label: "Open feature details";
	featureId: string;
	path: string;
	available: boolean;
	availability: FeatureDocDrilldownAvailability;
	sessionLocation: FeatureDocSessionLocation;
	sessionDir: string;
	sessionPath: string;
	sessionId?: string;
	completedDirName?: string;
};

type FeatureDocDrilldownBaseSource = {
	location: FeatureDocSessionLocation;
	sessionId?: string;
	completedDirName?: string;
	worktree?: string;
};

export type FeatureDocDrilldownSource =
	| (FeatureDocDrilldownBaseSource & {
			sessionDir: string;
	  })
	| (FeatureDocDrilldownBaseSource & {
			sessionPath: string;
	  })
	| {
			location: LiveSessionLocation;
			worktree: string;
			sessionId: string;
	  }
	| {
			location: "completed";
			worktree: string;
			completedDirName: string;
			sessionId?: string;
	  };

type FeatureDocDrilldownInput = {
	featureId: string;
	source: FeatureDocDrilldownSource;
};

function isMissingPathError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

async function pathIsDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

async function pathIsFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

function resolveSessionSourcePath(path: string, worktree?: string): string {
	return worktree && !isAbsolute(path) ? resolve(worktree, path) : path;
}

function expectedSessionRoot(
	location: FeatureDocSessionLocation,
	worktree: string,
): string {
	switch (location) {
		case "active":
			return getActiveSessionsDir(worktree);
		case "stored":
			return getStoredSessionsDir(worktree);
		case "completed":
			return getCompletedSessionsDir(worktree);
	}
}

function requireSourceWorktree(
	source: FeatureDocDrilldownSource &
		({ sessionDir: string } | { sessionPath: string }),
): string {
	if (!source.worktree) {
		throw new InvalidFlowPathInputError(
			"session",
			"worktree_required_for_explicit_session_source",
		);
	}
	return source.worktree;
}

function validateDerivedSessionFields(
	source: FeatureDocDrilldownSource,
	fields: { sessionDir: string; sessionPath: string },
): { sessionDir: string; sessionPath: string } {
	if (!("sessionDir" in source || "sessionPath" in source)) {
		return fields;
	}

	const worktree = requireSourceWorktree(source);
	const root = expectedSessionRoot(source.location, worktree);
	assertDescendant(root, fields.sessionDir);

	if (source.location === "completed" && source.completedDirName) {
		const expectedDir = getCompletedSessionDir(
			worktree,
			source.completedDirName,
		);
		if (fields.sessionDir !== expectedDir) {
			throw new InvalidFlowPathInputError("session", fields.sessionDir);
		}
	}

	if (source.location !== "completed" && source.sessionId) {
		const expectedDir = getSessionDir(
			worktree,
			source.sessionId,
			source.location,
		);
		if (fields.sessionDir !== expectedDir) {
			throw new InvalidFlowPathInputError("session", fields.sessionDir);
		}
	}

	if ("sessionPath" in source) {
		const expectedSessionPath = getSessionPathFromDir(fields.sessionDir);
		if (fields.sessionPath !== expectedSessionPath) {
			throw new InvalidFlowPathInputError("session", fields.sessionPath);
		}
	}

	return fields;
}

function deriveSessionFields(source: FeatureDocDrilldownSource): {
	sessionDir: string;
	sessionPath: string;
} {
	if ("sessionDir" in source) {
		const sessionDir = resolveSessionSourcePath(
			source.sessionDir,
			source.worktree,
		);
		return validateDerivedSessionFields(source, {
			sessionDir,
			sessionPath: getSessionPathFromDir(sessionDir),
		});
	}

	if ("sessionPath" in source) {
		const sessionPath = resolveSessionSourcePath(
			source.sessionPath,
			source.worktree,
		);
		return validateDerivedSessionFields(source, {
			sessionDir: dirname(sessionPath),
			sessionPath,
		});
	}

	if (source.location === "completed") {
		const sessionDir = getCompletedSessionDir(
			source.worktree,
			source.completedDirName,
		);
		return {
			sessionDir,
			sessionPath: getSessionPathFromDir(sessionDir),
		};
	}

	const sessionDir = getSessionDir(
		source.worktree,
		source.sessionId,
		source.location,
	);
	return {
		sessionDir,
		sessionPath: getSessionPath(
			source.worktree,
			source.sessionId,
			source.location,
		),
	};
}

function deriveFeatureDocDrilldownTarget(
	input: FeatureDocDrilldownInput,
): Omit<FeatureDocDrilldownTarget, "available" | "availability"> {
	const source = input.source;
	const fields = deriveSessionFields(source);
	const path = getFeatureDocPathFromSessionDir(
		fields.sessionDir,
		input.featureId,
	);

	return {
		kind: "feature_doc",
		label: "Open feature details",
		featureId: input.featureId,
		path,
		sessionLocation: source.location,
		sessionDir: fields.sessionDir,
		sessionPath: fields.sessionPath,
		...(source.sessionId ? { sessionId: source.sessionId } : {}),
		...("completedDirName" in source && source.completedDirName
			? { completedDirName: source.completedDirName }
			: {}),
	};
}

export async function resolveFeatureDocDrilldownTarget(
	input: FeatureDocDrilldownInput,
): Promise<FeatureDocDrilldownTarget> {
	const target = deriveFeatureDocDrilldownTarget(input);

	if (!(await pathIsDirectory(target.sessionDir))) {
		return {
			...target,
			available: false,
			availability: "missing_session_root",
		};
	}

	if (!(await pathIsFile(target.path))) {
		return {
			...target,
			available: false,
			availability: "missing_feature_doc",
		};
	}

	return {
		...target,
		available: true,
		availability: "available",
	};
}
