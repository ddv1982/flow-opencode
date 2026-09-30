export type HostMessage = Readonly<{
	id: string;
	role: string;
	parentID?: string;
	summary?: unknown;
}>;

export type HostPart = Readonly<{
	type: string;
	messageID: string;
	auto?: boolean;
	synthetic?: boolean;
	metadata?: Readonly<Record<string, unknown>>;
}>;

type Anchor = Readonly<{ authority: string; user: string }>;
type Summary = Anchor & Readonly<{ summary: string }>;
export type Compaction =
	| (Anchor & Readonly<{ kind: "awaiting-summary" }>)
	| (Summary & Readonly<{ kind: "awaiting-user" }>)
	| (Summary & Readonly<{ kind: "awaiting-marker"; candidate: string }>)
	| (Summary & Readonly<{ kind: "authenticated"; successor: string }>);

export function observeCompactionMessage(
	chain: Compaction | null,
	authority: string | null,
	message: HostMessage,
): Compaction | null {
	if (!chain) return null;
	if (message.role === "assistant") {
		if (
			message.summary !== true ||
			message.parentID !== chain.user ||
			authority !== chain.authority
		)
			return null;
		if (chain.kind !== "awaiting-summary")
			return chain.summary === message.id ? chain : null;
		return { ...chain, kind: "awaiting-user", summary: message.id };
	}
	if (message.role !== "user" || message.summary !== undefined) return chain;
	if (message.id === chain.user || message.id === chain.authority) return chain;
	switch (chain.kind) {
		case "awaiting-summary":
			return null;
		case "awaiting-user":
			return { ...chain, kind: "awaiting-marker", candidate: message.id };
		case "awaiting-marker":
			return chain.candidate === message.id ? chain : null;
		case "authenticated":
			return chain.successor === message.id ? chain : null;
	}
}

export function observeCompactionPart(
	chain: Compaction | null,
	authority: string | null,
	lastAssistantParent: string | null,
	part: HostPart,
): Compaction | null {
	if (part.type === "compaction") {
		if (part.auto !== true || !authority || lastAssistantParent !== authority)
			return null;
		if (chain?.user === part.messageID && chain.authority === authority)
			return chain;
		return { kind: "awaiting-summary", user: part.messageID, authority };
	}
	if (part.metadata?.compaction_continue !== true) return chain;
	if (
		part.type !== "text" ||
		part.synthetic !== true ||
		!chain ||
		authority !== chain.authority
	)
		return null;
	if (chain.kind === "authenticated")
		return chain.successor === part.messageID ? chain : null;
	if (chain.kind !== "awaiting-marker" || chain.candidate !== part.messageID)
		return null;
	return {
		kind: "authenticated",
		authority: chain.authority,
		user: chain.user,
		summary: chain.summary,
		successor: part.messageID,
	};
}

export function authenticatedCompactionSuccessor(
	chain: Compaction | null,
	authority: string,
): string | null {
	return chain?.kind === "authenticated" && chain.authority === authority
		? chain.successor
		: null;
}
