import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function writeExclusive(
	path: string,
	value: unknown,
): Promise<void> {
	return writeBytesExclusive(
		path,
		Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
	);
}

export async function writeBytesExclusive(
	path: string,
	bytes: Uint8Array,
): Promise<void> {
	const directory = dirname(path);
	const temporary = join(directory, `.pending-${randomUUID()}`);
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(bytes);
		await file.sync();
		await file.close();
		await link(temporary, path);
		if (process.platform !== "win32") {
			const parent = await open(directory, "r");
			try {
				await parent.sync();
			} finally {
				await parent.close();
			}
		}
	} finally {
		await file.close();
		await unlink(temporary);
	}
}
