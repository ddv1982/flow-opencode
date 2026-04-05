export function nowIso(): string {
  return new Date().toISOString();
}

export function toArchiveTimestamp(value: string): string {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "");
}

export function archiveTimestampNow(): string {
  return toArchiveTimestamp(nowIso());
}
