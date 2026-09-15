import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type EvidenceRef, EvidenceRefSchema } from "./benchmark-evidence.js";
import { canonicalJson } from "./canonical-json.js";

export const MAX_EVIDENCE_OBJECT_BYTES = 64 * 1024 * 1024;
export function evidenceSha256(bytes: Uint8Array | string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export class EvidenceStore {
	readonly directory: string;
	constructor(directory: string) {
		this.directory = directory;
	}

	async read(ref: EvidenceRef): Promise<Buffer> {
		EvidenceRefSchema.parse(ref);
		if (ref.bytes > MAX_EVIDENCE_OBJECT_BYTES)
			throw new Error("Evidence object exceeds its byte limit.");
		if (ref.artifact !== `objects/${ref.sha256.replace(":", "-")}`)
			throw new Error("Evidence object path does not match its digest.");
		const objects = join(this.directory, "objects");
		if (!(await lstat(objects)).isDirectory())
			throw new Error("Evidence object directory is not a regular directory.");
		const handle = await open(
			join(this.directory, ref.artifact),
			constants.O_RDONLY |
				(process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
		);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size !== ref.bytes)
				throw new Error("Evidence object size or file kind differs.");
			const bytes = await handle.readFile();
			if (bytes.length !== ref.bytes || evidenceSha256(bytes) !== ref.sha256)
				throw new Error("Evidence object digest differs.");
			return bytes;
		} finally {
			await handle.close();
		}
	}

	async write(bytes: Uint8Array): Promise<EvidenceRef> {
		if (bytes.byteLength > MAX_EVIDENCE_OBJECT_BYTES)
			throw new Error("Evidence object exceeds its byte limit.");
		const sha256 = evidenceSha256(bytes);
		const ref: EvidenceRef = {
			artifact: `objects/${sha256.replace(":", "-")}`,
			sha256,
			bytes: bytes.byteLength,
		};
		const objects = join(this.directory, "objects");
		await mkdir(objects, { recursive: true, mode: 0o700 });
		if (!(await lstat(objects)).isDirectory())
			throw new Error("Evidence object directory is not a regular directory.");
		const target = join(this.directory, ref.artifact);
		try {
			await this.read(ref);
			return ref;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const temporary = join(objects, `.pending-${crypto.randomUUID()}`);
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		try {
			try {
				await link(temporary, target);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				await this.read(ref);
			}
		} finally {
			await unlink(temporary);
		}
		if (process.platform !== "win32") {
			const directory = await open(objects, "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		}
		return ref;
	}

	async writeJson(value: unknown): Promise<EvidenceRef> {
		return this.write(Buffer.from(canonicalJson(value)));
	}

	async readJson(ref: EvidenceRef): Promise<unknown> {
		return JSON.parse((await this.read(ref)).toString("utf8"));
	}
}
