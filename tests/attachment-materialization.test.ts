import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_ATTACHMENT_MAX_BYTES } from "../src/adapters/opencode/attachment-materialization";
import {
	captureOpenCodeAttachments,
	clearFlowAttachments,
	FLOW_ATTACHMENT_TTL_MS,
	listFlowAttachments,
} from "../src/adapters/opencode/attachment-store";
import {
	createTempDirRegistry,
	createTestTools,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-attachments-");

const PNG_HEADER_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPEG_HEADER_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP_HEADER_BYTES = Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "binary");
const GIF_HEADER_BYTES = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");
const AVIF_HEADER_BYTES = Buffer.concat([
	Buffer.from([0x00, 0x00, 0x00, 0x20]),
	Buffer.from("ftypavif\x00\x00\x00\x00avifmif1", "binary"),
]);

function dataUrl(mime: string, bytes: Buffer) {
	return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function materialize(
	worktree: string,
	args: Record<string, unknown>,
	sessionID = "session-1",
	extra: Record<string, unknown> = {},
) {
	const tools = createTestTools();
	const response = await tools.flow_attachments_materialize.execute(
		args,
		toolContext(worktree, undefined, {
			sessionID,
			agent: "flow-auto",
			...extra,
		}),
	);
	return JSON.parse(response) as {
		status: string;
		summary: string;
		imported: Array<{
			attachmentId: string;
			path: string;
			bytes: number;
			mime: string;
		}>;
		skipped: Array<{ attachmentId?: string; reason: string }>;
	};
}

afterEach(() => {
	clearFlowAttachments();
	cleanupTempDirs();
});

describe("OpenCode attachment capture and materialization", () => {
	test("captures supported image FilePart-like records, excludes SVG, and expires stale entries", () => {
		captureOpenCodeAttachments(
			{
				sessionId: "session-1",
				messageId: "message-1",
				parts: [
					{
						id: "png-1",
						type: "file",
						mime: "image/png",
						filename: "background.png",
						url: dataUrl("image/png", PNG_HEADER_BYTES),
					},
					{
						id: "jpg-1",
						type: "file",
						mime: "image/jpg",
						filename: "photo.jpg",
						url: dataUrl("image/jpeg", JPEG_HEADER_BYTES),
					},
					{
						id: "webp-1",
						type: "file",
						mime: "image/webp",
						filename: "card.webp",
						url: dataUrl("image/webp", WEBP_HEADER_BYTES),
					},
					{
						id: "gif-1",
						type: "file",
						mime: "image/gif",
						filename: "motion.gif",
						url: dataUrl("image/gif", GIF_HEADER_BYTES),
					},
					{
						id: "avif-1",
						type: "file",
						mime: "image/avif",
						filename: "hero.avif",
						url: dataUrl("image/avif", AVIF_HEADER_BYTES),
					},
					{
						id: "svg-1",
						type: "file",
						mime: "image/svg+xml",
						filename: "unsafe.svg",
						url: "data:image/svg+xml;base64,PHN2Zy8+",
					},
					{ type: "text", text: "not a file" },
				],
			},
			1_000,
		);

		expect(
			listFlowAttachments("session-1", 1_000).map(({ id, mime }) => ({
				id,
				mime,
			})),
		).toEqual([
			{ id: "png-1", mime: "image/png" },
			{ id: "jpg-1", mime: "image/jpeg" },
			{ id: "webp-1", mime: "image/webp" },
			{ id: "gif-1", mime: "image/gif" },
			{ id: "avif-1", mime: "image/avif" },
		]);
		expect(
			listFlowAttachments("session-1", 1_000 + FLOW_ATTACHMENT_TTL_MS + 1),
		).toEqual([]);
	});

	test("materializes supported image data URLs with safe deterministic names and extensions", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "../Hero Background.PNG",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
				{
					id: "png-2",
					type: "file",
					mime: "image/png",
					filename: "Hero Background.PNG",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
				{
					id: "jpg-misleading-extension",
					type: "file",
					mime: "image/jpeg",
					filename: "Actually A Photo.png",
					url: dataUrl("image/jpeg", JPEG_HEADER_BYTES),
				},
				{
					id: "webp-1",
					type: "file",
					mime: "image/webp",
					filename: "Marketing Card",
					url: dataUrl("image/webp", WEBP_HEADER_BYTES),
				},
				{
					id: "gif-1",
					type: "file",
					mime: "image/gif",
					filename: "Spinner.GIF",
					url: dataUrl("image/gif", GIF_HEADER_BYTES),
				},
				{
					id: "avif-1",
					type: "file",
					mime: "image/avif",
					filename: "Hero.AVIF",
					url: dataUrl("image/avif", AVIF_HEADER_BYTES),
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets/images",
		});

		expect(response.status).toBe("ok");
		expect(response.imported.map((item) => item.path)).toEqual([
			"assets/images/hero-background.png",
			"assets/images/hero-background-2.png",
			"assets/images/actually-a-photo.jpg",
			"assets/images/marketing-card.webp",
			"assets/images/spinner.gif",
			"assets/images/hero.avif",
		]);
		for (const item of response.imported) {
			expect(await readFile(join(worktree, item.path))).toHaveLength(
				item.bytes,
			);
		}
	});

	test("does not fall back to stale supported attachments after an unsupported-only latest batch", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "old-png",
					type: "file",
					mime: "image/png",
					filename: "old.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "svg-1",
					type: "file",
					mime: "image/svg+xml",
					filename: "unsafe.svg",
					url: "data:image/svg+xml;base64,PHN2Zy8+",
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});
		expect(response.status).toBe("error");
		expect(response.imported).toEqual([]);
		expect(response.skipped).toEqual([
			expect.objectContaining({
				attachmentId: "svg-1",
				filename: "unsafe.svg",
				reason: expect.stringContaining("Unsupported attachment MIME"),
			}),
		]);
		await expect(stat(join(worktree, "assets", "old.png"))).rejects.toThrow();
	});

	test("returns partial and skipped metadata for mixed supported and unsupported latest batches", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
				{
					id: "svg-1",
					type: "file",
					mime: "image/svg+xml",
					filename: "unsafe.svg",
					url: "data:image/svg+xml;base64,PHN2Zy8+",
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});

		expect(response.status).toBe("partial");
		expect(response.imported.map((item) => item.path)).toEqual([
			"assets/safe.png",
		]);
		expect(response.skipped).toEqual([
			expect.objectContaining({
				attachmentId: "svg-1",
				reason: expect.stringContaining("Unsupported attachment MIME"),
			}),
		]);
	});

	test("flow_auto_prepare guidance args use implicit materialization and surface skipped batch records", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
				{
					id: "svg-1",
					type: "file",
					mime: "image/svg+xml",
					filename: "unsafe.svg",
					url: "data:image/svg+xml;base64,PHN2Zy8+",
				},
			],
		});
		const prepared = JSON.parse(
			await tools.flow_auto_prepare.execute(
				{ argumentString: "Use attached assets" },
				toolContext(worktree, undefined, {
					sessionID: "session-1",
					agent: "flow-auto",
				}),
			),
		);

		expect(prepared.attachmentGuidance.materializationRequired).toBe(true);
		expect(prepared.attachmentGuidance.materialize.args).toEqual({
			destinationDirectory: "assets/flow-attachments",
		});
		const response = JSON.parse(
			await tools.flow_attachments_materialize.execute(
				prepared.attachmentGuidance.materialize.args,
				toolContext(worktree, undefined, {
					sessionID: "session-1",
					agent: "flow-auto",
				}),
			),
		) as Awaited<ReturnType<typeof materialize>>;

		expect(response.status).toBe("partial");
		expect(response.imported.map((item) => item.path)).toEqual([
			"assets/flow-attachments/safe.png",
		]);
		expect(
			await readFile(join(worktree, "assets/flow-attachments/safe.png")),
		).toEqual(PNG_HEADER_BYTES);
		expect(response.skipped).toEqual([
			expect.objectContaining({
				attachmentId: "svg-1",
				filename: "unsafe.svg",
				reason: expect.stringContaining("Unsupported attachment MIME"),
			}),
		]);
	});

	test("defaults to current message or latest batch and requires explicit selectors for older attachments", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			messageId: "old-message",
			parts: [
				{
					id: "old-png",
					type: "file",
					mime: "image/png",
					filename: "old.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});
		captureOpenCodeAttachments({
			sessionId: "session-1",
			messageId: "current-message",
			parts: [
				{
					id: "current-png",
					type: "file",
					mime: "image/png",
					filename: "current.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const current = await materialize(
			worktree,
			{ destinationDirectory: "assets" },
			"session-1",
			{ messageID: "current-message" },
		);
		expect(current.status).toBe("ok");
		expect(current.imported.map((item) => item.path)).toEqual([
			"assets/current.png",
		]);

		const old = await materialize(worktree, {
			destinationDirectory: "assets",
			attachments: [{ id: "old-png" }],
		});
		expect(old.status).toBe("ok");
		expect(old.imported.map((item) => item.path)).toEqual(["assets/old.png"]);
	});

	test("requires a proven flow-auto tool context", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});
		const tools = createTestTools();
		const response = JSON.parse(
			await tools.flow_attachments_materialize.execute(
				{ destinationDirectory: "assets" },
				toolContext(worktree, undefined, { sessionID: "session-1" }),
			),
		) as { status: string; summary: string; imported: unknown[] };

		expect(response.status).toBe("error");
		expect(response.summary).toContain("flow-auto tool context");
		expect(response.imported).toEqual([]);
	});

	test("returns early without permission prompts or directory creation when no attachments are selected", async () => {
		const worktree = makeTempDir();
		const ask = mock(async () => undefined);
		const metadata = mock(() => undefined);
		const tools = createTestTools();

		const response = JSON.parse(
			await tools.flow_attachments_materialize.execute(
				{ destinationDirectory: "assets" },
				toolContext(worktree, undefined, {
					sessionID: "session-1",
					agent: "flow-auto",
					ask,
					metadata,
				}),
			),
		) as {
			status: string;
			imported: unknown[];
			skipped: Array<{ reason: string }>;
		};

		expect(response.status).toBe("error");
		expect(response.imported).toEqual([]);
		expect(response.skipped[0]?.reason).toContain(
			"No current or latest supported image attachment batch",
		);
		expect(ask).not.toHaveBeenCalled();
		expect(metadata).toHaveBeenCalled();
		await expect(stat(join(worktree, "assets"))).rejects.toThrow();
	});

	test("rejects glob metacharacters in destination directories before permission prompts", async () => {
		const worktree = makeTempDir();
		const ask = mock(async () => undefined);
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const response = await materialize(
			worktree,
			{ destinationDirectory: "assets/[literal]" },
			"session-1",
			{ ask },
		);

		expect(response.status).toBe("error");
		expect(response.skipped[0]?.reason).toContain("glob metacharacters");
		expect(ask).not.toHaveBeenCalled();
		await expect(stat(join(worktree, "assets"))).rejects.toThrow();
	});

	test("rejects traversal and .flow destinations case-insensitively without writing assets", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const traversal = await materialize(worktree, {
			destinationDirectory: "../escape",
		});
		expect(traversal.status).toBe("error");
		expect(traversal.skipped[0]?.reason).toContain(
			"inside the active workspace",
		);

		for (const destinationDirectory of [
			".flow/assets",
			".FLOW/assets",
			".Flow/assets",
		]) {
			const flowDir = await materialize(worktree, { destinationDirectory });
			expect(flowDir.status).toBe("error");
			expect(flowDir.skipped[0]?.reason).toContain("must not be inside .flow");
		}
		await expect(stat(join(worktree, "assets", "safe.png"))).rejects.toThrow();
	});

	test("rejects symlink destination ancestors before creating directories", async () => {
		const worktree = makeTempDir();
		const outside = makeTempDir();
		await symlink(outside, join(worktree, "linked-assets"));
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "linked-assets/nested",
		});

		expect(response.status).toBe("error");
		expect(response.skipped[0]?.reason).toContain("symlink");
		await expect(stat(join(outside, "nested"))).rejects.toThrow();
	});

	test("preserves abort semantics instead of returning a normal materialization response", async () => {
		const worktree = makeTempDir();
		const abort = new AbortController();
		abort.abort();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});
		const tools = createTestTools();

		await expect(
			tools.flow_attachments_materialize.execute(
				{ destinationDirectory: "assets" },
				toolContext(worktree, undefined, {
					sessionID: "session-1",
					agent: "flow-auto",
					abort: abort.signal,
				}),
			),
		).rejects.toHaveProperty("name", "AbortError");
	});

	test("uses exclusive final writes for collisions without overwriting existing files", async () => {
		const worktree = makeTempDir();
		await mkdir(join(worktree, "assets"), { recursive: true });
		await writeFile(join(worktree, "assets", "hero.png"), "existing");
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "hero.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});

		expect(response.status).toBe("ok");
		expect(response.imported.map((item) => item.path)).toEqual([
			"assets/hero-2.png",
		]);
		expect(await readFile(join(worktree, "assets", "hero.png"), "utf8")).toBe(
			"existing",
		);
		expect(await readFile(join(worktree, "assets", "hero-2.png"))).toEqual(
			PNG_HEADER_BYTES,
		);
	});

	test("does not follow existing symlink file targets while resolving collisions", async () => {
		const worktree = makeTempDir();
		const outside = makeTempDir();
		await mkdir(join(worktree, "assets"), { recursive: true });
		await writeFile(join(outside, "target.png"), "outside");
		await symlink(
			join(outside, "target.png"),
			join(worktree, "assets", "hero.png"),
		);
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "hero.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});

		expect(response.status).toBe("ok");
		expect(response.imported.map((item) => item.path)).toEqual([
			"assets/hero-2.png",
		]);
		expect(await readFile(join(outside, "target.png"), "utf8")).toBe("outside");
		expect(await readFile(join(worktree, "assets", "hero-2.png"))).toEqual(
			PNG_HEADER_BYTES,
		);
	});

	test("returns partial when some selected attachments import and others skip", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
				{
					id: "bad-1",
					type: "file",
					mime: "image/png",
					filename: "bad.png",
					url: dataUrl("image/png", Buffer.from("not-a-png")),
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});

		expect(response.status).toBe("partial");
		expect(response.imported.map((item) => item.path)).toEqual([
			"assets/safe.png",
		]);
		expect(response.skipped).toEqual([
			expect.objectContaining({
				attachmentId: "bad-1",
				reason: expect.stringContaining("valid image/png payload"),
			}),
		]);
	});

	test("rejects file and HTTP attachment URLs without importing them", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "file-1",
					type: "file",
					mime: "image/jpeg",
					filename: "photo.jpeg",
					url: "file:///tmp/source.jpeg",
				},
				{
					id: "http-1",
					type: "file",
					mime: "image/png",
					filename: "from-http.png",
					url: "http://127.0.0.1/attachment.png",
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});

		expect(response.status).toBe("error");
		expect(response.imported).toEqual([]);
		expect(response.skipped).toEqual([
			expect.objectContaining({
				reason: expect.stringContaining("only data:"),
			}),
			expect.objectContaining({
				reason: expect.stringContaining("only data:"),
			}),
		]);
	});

	test("skips oversized data URLs at capture time without retaining supported records", async () => {
		const worktree = makeTempDir();
		const oversizedPayload = "A".repeat(
			Math.ceil(FLOW_ATTACHMENT_MAX_BYTES / 3) * 4 + 1,
		);
		const summary = captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "huge-1",
					type: "file",
					mime: "image/png",
					filename: "huge.png",
					url: `data:image/png;base64,${oversizedPayload}`,
				},
			],
		});

		expect(summary).toMatchObject({ captured: 0, skipped: 1 });
		expect(listFlowAttachments("session-1")).toEqual([]);
		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});

		expect(response.status).toBe("error");
		expect(response.imported).toEqual([]);
		expect(response.skipped).toEqual([
			expect.objectContaining({
				attachmentId: "huge-1",
				reason: expect.stringContaining("byte limit"),
			}),
		]);
		await expect(stat(join(worktree, "assets"))).rejects.toThrow();
	});

	test("rejects oversized data URLs before decoding payload bytes", async () => {
		const worktree = makeTempDir();
		const oversizedPayload = "A".repeat(
			Math.ceil(FLOW_ATTACHMENT_MAX_BYTES / 3) * 4 + 1,
		);
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "huge-1",
					type: "file",
					mime: "image/png",
					filename: "huge.png",
					url: `data:image/png;base64,${oversizedPayload}`,
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
		});

		expect(response.status).toBe("error");
		expect(response.imported).toEqual([]);
		expect(response.skipped[0]?.reason).toContain("byte limit");
	});

	test("selectors report missing captured attachments without materializing all records", async () => {
		const worktree = makeTempDir();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "selected.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const response = await materialize(worktree, {
			destinationDirectory: "assets",
			attachments: [{ id: "missing" }],
		});

		expect(response.status).toBe("error");
		expect(response.imported).toEqual([]);
		expect(response.skipped[0]?.reason).toContain(
			"No captured supported image attachment",
		);
	});
});
