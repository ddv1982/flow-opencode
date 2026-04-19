let nowIsoOverride: (() => string) | null = null;

export function setNowIsoOverride(fn: (() => string) | null): void {
	nowIsoOverride = fn;
}

export function nowIso(): string {
	return nowIsoOverride ? nowIsoOverride() : new Date().toISOString();
}

export function toCompletedTimestamp(value: string): string {
	return value.replace(/[-:]/g, "").replace(/Z$/, "");
}

export function completedTimestampNow(): string {
	return toCompletedTimestamp(nowIso());
}
