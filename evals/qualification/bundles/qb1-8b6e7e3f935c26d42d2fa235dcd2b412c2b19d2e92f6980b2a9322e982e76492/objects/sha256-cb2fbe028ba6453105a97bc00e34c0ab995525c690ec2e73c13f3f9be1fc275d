import { type BigIntStats, constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import {
	type ObservedValidation,
	persistObservedValidation,
	prepareValidation,
} from "../../application/prepare-validation.js";
import type { ValidationStartRequest } from "../../application/schema.js";
import { MAX_TEST_REPORT_BYTES } from "../../domain/limits.js";
import { normalizeEvidencePlatform } from "../../domain/validation.js";
import { createFileSessionRepository } from "./session-repository.js";

export function prepareWorkspaceValidation(
	workspace: string,
	input: ValidationStartRequest,
) {
	return prepareValidation(
		createFileSessionRepository(workspace),
		input,
		normalizeEvidencePlatform(process.platform),
	);
}

type PathSnapshot = Readonly<{ path: string; info: BigIntStats }>;

function contained(relativePath: string): boolean {
	return (
		relativePath !== "" &&
		!isAbsolute(relativePath) &&
		relativePath.split(/[\\/]/)[0] !== ".."
	);
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
	return left.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
}

async function inspectReportPath(
	root: string,
	target: string,
): Promise<PathSnapshot[] | null> {
	const parts = relative(root, target).split(sep);
	const paths = [root];
	for (const part of parts) paths.push(join(paths.at(-1) ?? root, part));
	const snapshots: PathSnapshot[] = [];
	for (const [index, path] of paths.entries()) {
		const info = await lstat(path, { bigint: true });
		if (
			info.isSymbolicLink() ||
			(index < paths.length - 1 ? !info.isDirectory() : !info.isFile())
		)
			return null;
		snapshots.push({ path, info });
	}
	return snapshots;
}

function samePath(
	before: readonly PathSnapshot[],
	after: readonly PathSnapshot[],
): boolean {
	return (
		before.length === after.length &&
		before.every((entry, index) => {
			const next = after[index];
			return next?.path === entry.path && sameFile(entry.info, next.info);
		})
	);
}

/**
 * Reads a test report the command wrote, or `null`.
 *
 * Every rejection is the same `null`, because no report and no readable report mean
 * the same thing downstream. Path components cannot be symlinks. Type, size, bytes,
 * and modification time must also remain stable on one open handle.
 */
export async function readWorkspaceTestReport(
	workspace: string,
	relativePath: string,
	checkpoint?:
		| ((stage: "inspected" | "opened" | "read") => Promise<void>)
		| undefined,
): Promise<{ text: string; modifiedMs: number } | null> {
	try {
		if (isAbsolute(relativePath) || win32.isAbsolute(relativePath)) return null;
		const requestedRoot = resolve(workspace);
		const inside = relative(
			requestedRoot,
			resolve(requestedRoot, relativePath),
		);
		if (!contained(inside)) return null;
		const root = await realpath(requestedRoot);
		const target = resolve(root, inside);
		const beforePath = await inspectReportPath(root, target);
		if (!beforePath) return null;
		await checkpoint?.("inspected");
		const targetReal = await realpath(target);
		if (!contained(relative(root, targetReal))) return null;

		const flags =
			process.platform === "win32"
				? constants.O_RDONLY
				: constants.O_RDONLY | constants.O_NOFOLLOW;
		const handle = await open(targetReal, flags);
		try {
			await checkpoint?.("opened");
			const before = await handle.stat({ bigint: true });
			const leaf = beforePath.at(-1)?.info;
			if (
				!leaf ||
				!before.isFile() ||
				!sameFile(leaf, before) ||
				before.size > BigInt(MAX_TEST_REPORT_BYTES)
			)
				return null;

			const bytes = Buffer.allocUnsafe(Number(before.size) + 1);
			let length = 0;
			while (length < bytes.length) {
				const read = await handle.read(
					bytes,
					length,
					bytes.length - length,
					length,
				);
				if (read.bytesRead === 0) break;
				length += read.bytesRead;
			}
			if (length > MAX_TEST_REPORT_BYTES) return null;
			await checkpoint?.("read");

			const after = await handle.stat({ bigint: true });
			const afterPath = await inspectReportPath(root, target);
			if (
				!afterPath ||
				(await realpath(target)) !== targetReal ||
				!samePath(beforePath, afterPath) ||
				!after.isFile() ||
				!sameFile(before, after) ||
				before.mode !== after.mode ||
				before.size !== after.size ||
				before.ctimeNs !== after.ctimeNs ||
				before.mtimeNs !== after.mtimeNs ||
				BigInt(length) !== after.size
			)
				return null;
			let text: string;
			try {
				text = new TextDecoder("utf-8", { fatal: true }).decode(
					bytes.subarray(0, length),
				);
			} catch (error) {
				if (error instanceof TypeError) return null;
				throw error;
			}
			return {
				text,
				modifiedMs: Number(after.mtimeNs) / 1_000_000,
			};
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			typeof error.code === "string"
		)
			return null;
		throw error;
	}
}

export function persistWorkspaceValidation(
	workspace: string,
	input: ObservedValidation,
) {
	return persistObservedValidation(
		createFileSessionRepository(workspace),
		input,
	);
}
