export async function materializeQualificationArchive(input: {
	readonly descriptorPath: string;
	readonly outputRoot: string;
}): Promise<string> {
	throw new Error(
		`Archive materialization is not implemented: ${input.descriptorPath}`,
	);
}
