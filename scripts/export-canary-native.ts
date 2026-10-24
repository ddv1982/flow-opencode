import { realpath } from "node:fs/promises";
import type {
	OpenCodeClient,
	ServerInfo,
	SessionTransferData,
} from "@opencode/client";
import { OPENCODE_HOST_VERSION } from "../evals/opencode-host.js";

export type NativeCanaryExport = {
	readonly schemaVersion: 2;
	readonly host: ServerInfo & {
		readonly location: { readonly directory: string };
	};
	readonly sessions: readonly SessionTransferData[];
};

type CanaryClient = {
	readonly server: Pick<OpenCodeClient["server"], "info">;
	readonly session: Pick<
		OpenCodeClient["session"],
		"list" | "export" | "active"
	>;
};
export async function collectNativeCanary(
	client: CanaryClient,
	input: {
		readonly directory: string;
		readonly rootSessionID: string;
		readonly signal?: AbortSignal;
	},
): Promise<NativeCanaryExport> {
	const directory = await realpath(input.directory);
	const request = () => ({
		signal: AbortSignal.any([
			...(input.signal ? [input.signal] : []),
			AbortSignal.timeout(30000),
		]),
	});
	const host = await client.server.info(request());
	if (host.version !== OPENCODE_HOST_VERSION)
		throw new Error("Canary server is not the pinned OpenCode host.");
	const descendants = async () => {
		const all: SessionTransferData["info"][] = [];
		const cursors = new Set<string>();
		let cursor: string | undefined;
		for (;;) {
			const page = await client.session.list(
				{
					limit: 100,
					...(cursor ? { cursor } : { directory, order: "asc" as const }),
				},
				request(),
			);
			all.push(...page.data);
			cursor = page.cursor.next ?? undefined;
			if (all.length > 4096)
				throw new Error("Canary session census exceeds its bound.");
			if (!cursor) break;
			if (cursors.has(cursor))
				throw new Error("Canary session pagination did not converge.");
			cursors.add(cursor);
		}
		if (new Set(all.map((session) => session.id)).size !== all.length)
			throw new Error("Canary session census contains duplicate identities.");
		const root = all.find((session) => session.id === input.rootSessionID);
		if (!root || root.parentID !== undefined)
			throw new Error("Canary manager must be a native root session.");
		const selected = new Set([root.id]);
		for (let changed = true; changed; ) {
			changed = false;
			for (const session of all) {
				if (
					session.parentID &&
					selected.has(session.parentID) &&
					!selected.has(session.id)
				) {
					selected.add(session.id);
					changed = true;
				}
			}
		}
		return all
			.filter((session) => selected.has(session.id))
			.sort((a, b) => a.id.localeCompare(b.id));
	};
	const census = await descendants();
	const sessions: SessionTransferData[] = [];
	for (const session of census) {
		const exported = await client.session.export(
			{
				sessionID: session.id,
				sanitize: false,
			},
			request(),
		);
		if (
			exported.info.id !== session.id ||
			(await realpath(exported.info.location.directory)) !== directory ||
			exported.info.parentID !== session.parentID ||
			exported.info.agent !== session.agent ||
			JSON.stringify(exported.info.model) !== JSON.stringify(session.model)
		)
			throw new Error(
				"Canary native session identity changed during collection.",
			);
		sessions.push(exported);
	}
	const after = await descendants();
	if (JSON.stringify(after) !== JSON.stringify(census))
		throw new Error("Canary session tree changed during collection.");
	const active = await client.session.active(request());
	if (sessions.some((session) => Object.hasOwn(active, session.info.id)))
		throw new Error("Canary sessions must be idle before collection.");
	const finalHost = await client.server.info(request());
	if (finalHost.version !== host.version || finalHost.pid !== host.pid)
		throw new Error("Canary server identity changed during collection.");
	return {
		schemaVersion: 2,
		host: { ...host, location: { directory } },
		sessions,
	};
}
