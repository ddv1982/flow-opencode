import { readFile } from "node:fs/promises";

export async function readOptionalFile(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
