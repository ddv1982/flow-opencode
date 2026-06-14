export function normalizeContextPath(value: string): string {
	const normalized = value.trim().replaceAll("\\", "/");
	if (normalized === "./") {
		return ".";
	}
	return normalized.replace(/^\.\//, "");
}

export function isCatchAllContextTarget(target: string): boolean {
	const normalizedTarget = normalizeContextPath(target);
	return (
		normalizedTarget === "." ||
		normalizedTarget === "*" ||
		normalizedTarget === "**/*"
	);
}

export function artifactMatchesTarget(path: string, target: string): boolean {
	const normalizedPath = normalizeContextPath(path);
	const normalizedTarget = normalizeContextPath(target);
	if (!normalizedPath || !normalizedTarget) {
		return false;
	}
	if (isCatchAllContextTarget(normalizedTarget)) {
		return true;
	}
	if (normalizedPath === normalizedTarget) {
		return true;
	}
	if (normalizedPath.startsWith(`${normalizedTarget}/`)) {
		return true;
	}
	if (
		normalizedTarget.endsWith("/") &&
		normalizedPath.startsWith(normalizedTarget)
	) {
		return true;
	}
	if (normalizedTarget.includes("*")) {
		const escaped = normalizedTarget
			.split("*")
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
			.join(".*");
		return new RegExp(`^${escaped}$`).test(normalizedPath);
	}
	return false;
}

export function artifactMatchesAnyTarget(
	path: string,
	targets: Iterable<string>,
): boolean {
	for (const target of targets) {
		if (artifactMatchesTarget(path, target)) {
			return true;
		}
	}
	return false;
}
