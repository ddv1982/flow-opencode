export function assertNoPrivateUserPaths(text: string): void {
	// Match Unix homes at path starts, not beneath another root such as /tmp.
	// Decode escaped slashes for inspection only; retained bytes stay untouched.
	const paths = text.replace(/\\+\//g, "/");
	if (
		/(?:(?:^|[\s"'`=():,;<>[\]{}!?|]|\\[nrtbf]|file:\/\/[^/\s"'<>]*)[*_~]*\/+(?:Users|home)\/[^/\s]+|[A-Za-z]:\\+Users\\+[^\\\s]+)/.test(
			paths,
		)
	)
		throw new Error("Qualification bundle contains an absolute user path.");
}
