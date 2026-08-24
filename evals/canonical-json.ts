import { createHash } from "node:crypto";

function canonicalString(value: string): string {
	if (!value.isWellFormed()) {
		throw new Error("Canonical JSON requires Unicode scalar values.");
	}
	return JSON.stringify(value);
}

export function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return canonicalString(value);
	if (typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("Canonical JSON requires finite numbers.");
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		if (Object.keys(value).length !== value.length) {
			throw new Error("Canonical JSON requires dense arrays.");
		}
		for (let index = 0; index < value.length; index += 1) {
			if (!Object.hasOwn(value, index)) {
				throw new Error("Canonical JSON requires dense arrays.");
			}
		}
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (
			(prototype !== Object.prototype && prototype !== null) ||
			Object.getOwnPropertySymbols(value).length > 0
		) {
			throw new Error("Canonical JSON requires plain JSON objects.");
		}
		const entries = Object.entries(value).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		);
		return `{${entries
			.map(([key, entry]) => `${canonicalString(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Canonical JSON requires JSON values.");
}

export function canonicalSha256(domain: string, value: unknown): string {
	return `sha256:${createHash("sha256")
		.update(`${domain}\u0000`)
		.update(canonicalJson(value))
		.digest("hex")}`;
}
