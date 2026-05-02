import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function candidateWorkspaceDirectories(
	workspaceRoot: string,
	startDirectory?: string,
): string[] {
	const resolvedRoot = resolve(workspaceRoot);
	let current = resolveWorkspaceStartDirectory(resolvedRoot, startDirectory);
	const directories: string[] = [];

	while (true) {
		directories.push(current);
		if (current === resolvedRoot) {
			return directories;
		}

		const parent = dirname(current);
		if (parent === current) {
			return directories;
		}
		current = parent;
	}
}

export function resolveWorkspaceStartDirectory(
	resolvedRoot: string,
	startDirectory?: string,
): string {
	if (!startDirectory) {
		return resolvedRoot;
	}

	const resolvedStart = isAbsolute(startDirectory)
		? resolve(startDirectory)
		: resolve(resolvedRoot, startDirectory);
	return isWithinWorkspaceRoot(resolvedRoot, resolvedStart)
		? resolvedStart
		: resolvedRoot;
}

export function isWithinWorkspaceRoot(
	root: string,
	candidate: string,
): boolean {
	const pathFromRoot = relative(root, candidate);
	return (
		pathFromRoot === "" ||
		(pathFromRoot !== ".." &&
			!pathFromRoot.startsWith(`..${sep}`) &&
			!isAbsolute(pathFromRoot))
	);
}
