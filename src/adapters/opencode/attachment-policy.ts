export const FLOW_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const FLOW_ATTACHMENT_ALLOWED_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
] as const;

export type FlowAttachmentMimeType =
	(typeof FLOW_ATTACHMENT_ALLOWED_MIME_TYPES)[number];

type FlowImageAttachmentPolicy = {
	mime: FlowAttachmentMimeType;
	aliases: readonly string[];
	canonicalExtension: string;
	matchesMagicBytes(bytes: Uint8Array): boolean;
};

export const FLOW_ATTACHMENT_IMAGE_POLICIES: readonly FlowImageAttachmentPolicy[] =
	[
		{
			mime: "image/png",
			aliases: [],
			canonicalExtension: ".png",
			matchesMagicBytes(bytes) {
				const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
				return png.every((value, index) => bytes[index] === value);
			},
		},
		{
			mime: "image/jpeg",
			aliases: ["image/jpg"],
			canonicalExtension: ".jpg",
			matchesMagicBytes(bytes) {
				return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
			},
		},
		{
			mime: "image/webp",
			aliases: [],
			canonicalExtension: ".webp",
			matchesMagicBytes(bytes) {
				return asciiEquals(bytes, 0, "RIFF") && asciiEquals(bytes, 8, "WEBP");
			},
		},
		{
			mime: "image/gif",
			aliases: [],
			canonicalExtension: ".gif",
			matchesMagicBytes(bytes) {
				return (
					asciiEquals(bytes, 0, "GIF87a") || asciiEquals(bytes, 0, "GIF89a")
				);
			},
		},
		{
			mime: "image/avif",
			aliases: [],
			canonicalExtension: ".avif",
			matchesMagicBytes(bytes) {
				return hasAvifBrand(bytes);
			},
		},
	];

const POLICY_BY_MIME = new Map(
	FLOW_ATTACHMENT_IMAGE_POLICIES.map((policy) => [policy.mime, policy]),
);
const MIME_BY_ALIAS = new Map<string, FlowAttachmentMimeType>();
for (const policy of FLOW_ATTACHMENT_IMAGE_POLICIES) {
	MIME_BY_ALIAS.set(policy.mime, policy.mime);
	for (const alias of policy.aliases) {
		MIME_BY_ALIAS.set(alias, policy.mime);
	}
}

export function normalizeFlowAttachmentMime(
	mime: unknown,
): FlowAttachmentMimeType | null {
	if (typeof mime !== "string") {
		return null;
	}
	const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
	return MIME_BY_ALIAS.get(normalized) ?? null;
}

export function policyForFlowAttachmentMime(
	mime: FlowAttachmentMimeType,
): FlowImageAttachmentPolicy {
	const policy = POLICY_BY_MIME.get(mime);
	if (!policy) {
		throw new Error(`Missing Flow attachment policy for '${mime}'.`);
	}
	return policy;
}

export function describeSupportedAttachmentFormats(): string {
	return "PNG, JPEG, WebP, GIF, and AVIF";
}

export function maxFlowAttachmentDataUrlPayloadLength(
	isBase64: boolean,
): number {
	return isBase64
		? Math.ceil(FLOW_ATTACHMENT_MAX_BYTES / 3) * 4
		: FLOW_ATTACHMENT_MAX_BYTES * 3;
}

function asciiEquals(
	bytes: Uint8Array,
	offset: number,
	expected: string,
): boolean {
	if (bytes.length < offset + expected.length) {
		return false;
	}
	for (let index = 0; index < expected.length; index += 1) {
		if (bytes[offset + index] !== expected.charCodeAt(index)) {
			return false;
		}
	}
	return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
	if (bytes.length < offset + length) {
		return "";
	}
	let value = "";
	for (let index = 0; index < length; index += 1) {
		value += String.fromCharCode(bytes[offset + index] ?? 0);
	}
	return value;
}

function hasAvifBrand(bytes: Uint8Array): boolean {
	if (bytes.length < 16 || !asciiEquals(bytes, 4, "ftyp")) {
		return false;
	}
	const compatibleBrands = new Set(["avif", "avis"]);
	for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
		if (compatibleBrands.has(asciiAt(bytes, offset, 4))) {
			return true;
		}
	}
	return false;
}
