let nowIsoOverride: (() => string) | null = null;

export function setNowIsoOverride(fn: (() => string) | null): void {
	nowIsoOverride = fn;
}

export function nowIso(): string {
	return nowIsoOverride ? nowIsoOverride() : new Date().toISOString();
}

export function toArchiveTimestamp(value: string): string {
	return value.replace(/[-:]/g, "").replace(/Z$/, "");
}

export function archiveTimestampNow(): string {
	return toArchiveTimestamp(nowIso());
}
