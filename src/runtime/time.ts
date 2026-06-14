let nowOverride: (() => string) | null = null;

export function setNowForTests(next: (() => string) | null): void {
	nowOverride = next;
}

export function nowIso(): string {
	return nowOverride?.() ?? new Date().toISOString();
}
