import { constants } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readdir,
	writeFile,
} from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { z } from "zod";
import { evidenceSha256 } from "./evidence-store.js";

export const MAX_FIXTURE_FILES = 2048;
export const MAX_FIXTURE_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const excluded = new Set([
	".git",
	".flow",
	".opencode",
	"node_modules",
	"opencode.json",
]);

export function fixturePath(path: string): boolean {
	return (
		path.length > 0 &&
		path.length <= 4096 &&
		!path.includes("\\") &&
		!posix.isAbsolute(path) &&
		path
			.split("/")
			.every(
				(part) =>
					part !== "" &&
					part !== "." &&
					part !== ".." &&
					!excluded.has(part.toLowerCase()) &&
					!/[<>:"|?*]/.test(part) &&
					part.isWellFormed() &&
					[...part].every((character) => character.charCodeAt(0) > 31) &&
					!/[. ]$/.test(part) &&
					!/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
			)
	);
}

export const FixtureSnapshotSchema = z
	.object({
		schemaVersion: z.literal(1),
		files: z
			.array(
				z
					.object({
						path: z
							.string()
							.refine(fixturePath, "Unsafe or reserved fixture path."),
						executable: z.boolean(),
						contentBase64: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4),
						sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
					})
					.strict(),
			)
			.max(MAX_FIXTURE_FILES),
	})
	.strict()
	.superRefine((snapshot, context) => {
		const paths = new Set<string>();
		let total = 0;
		for (const file of snapshot.files) {
			const bytes = Buffer.from(file.contentBase64, "base64");
			const key = file.path.normalize("NFC").toLowerCase();
			if (
				paths.has(key) ||
				bytes.toString("base64") !== file.contentBase64 ||
				bytes.length > MAX_FILE_BYTES ||
				evidenceSha256(bytes) !== file.sha256
			)
				context.addIssue({
					code: "custom",
					message:
						"Fixture entries must have unique portable paths and exact bounded bytes.",
				});
			paths.add(key);
			total += bytes.length;
		}
		for (const path of paths) {
			const segments = path.split("/");
			for (let length = 1; length < segments.length; length += 1)
				if (paths.has(segments.slice(0, length).join("/")))
					context.addIssue({
						code: "custom",
						message: "A fixture file cannot also be a parent directory.",
					});
		}
		if (total > MAX_FIXTURE_BYTES)
			context.addIssue({
				code: "custom",
				message: "Fixture exceeds its total byte limit.",
			});
	});
export type FixtureSnapshot = z.infer<typeof FixtureSnapshotSchema>;

export function snapshotFiles(
	files: Readonly<Record<string, string>>,
): FixtureSnapshot {
	return FixtureSnapshotSchema.parse({
		schemaVersion: 1,
		files: Object.entries(files)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([path, text]) => {
				const bytes = Buffer.from(text);
				return {
					path,
					executable: false,
					contentBase64: bytes.toString("base64"),
					sha256: evidenceSha256(bytes),
				};
			}),
	});
}

export async function snapshotProject(
	project: string,
): Promise<FixtureSnapshot> {
	const files: FixtureSnapshot["files"] = [];
	let total = 0;
	const visit = async (relative: string): Promise<void> => {
		for (const name of (await readdir(join(project, relative))).sort()) {
			if (excluded.has(name.toLowerCase())) continue;
			const path = relative ? `${relative}/${name}` : name;
			if (!fixturePath(path))
				throw new Error("Fixture contains an unsafe path.");
			const absolute = join(project, path);
			const stat = await lstat(absolute);
			if (stat.isDirectory()) {
				await visit(path);
				continue;
			}
			if (
				!stat.isFile() ||
				stat.size > MAX_FILE_BYTES ||
				files.length >= MAX_FIXTURE_FILES ||
				total + stat.size > MAX_FIXTURE_BYTES
			)
				throw new Error("Fixture contains an unsupported or oversized entry.");
			const handle = await open(
				absolute,
				constants.O_RDONLY |
					(process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
			);
			let bytes: Buffer;
			try {
				const opened = await handle.stat();
				if (
					!opened.isFile() ||
					opened.ino !== stat.ino ||
					opened.dev !== stat.dev ||
					opened.size !== stat.size
				)
					throw new Error("Fixture changed during capture.");
				bytes = await handle.readFile();
				if (bytes.length !== stat.size)
					throw new Error("Fixture changed during capture.");
			} finally {
				await handle.close();
			}
			total += bytes.length;
			files.push({
				path,
				executable: (stat.mode & 0o111) !== 0,
				contentBase64: bytes.toString("base64"),
				sha256: evidenceSha256(bytes),
			});
		}
	};
	if (!(await lstat(project)).isDirectory())
		throw new Error("Fixture root is not a directory.");
	await visit("");
	return FixtureSnapshotSchema.parse({ schemaVersion: 1, files });
}

export async function restoreSnapshot(
	input: unknown,
	directory: string,
): Promise<FixtureSnapshot> {
	const snapshot = FixtureSnapshotSchema.parse(input);
	if ((await readdir(directory)).length !== 0)
		throw new Error("Fixture restoration requires an empty directory.");
	for (const file of snapshot.files) {
		const target = join(directory, file.path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, Buffer.from(file.contentBase64, "base64"), {
			flag: "wx",
			mode: 0o600,
		});
		await chmod(target, file.executable ? 0o700 : 0o600);
	}
	return snapshot;
}
