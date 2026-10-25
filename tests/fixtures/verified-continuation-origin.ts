import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import { Agent, Model, Provider } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { CallID } from "@opencode/plugin/promise/tool";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import {
	type AutoDriveCoordinator,
	type AutoDriveDelivery,
	FLOW_AUTO_METADATA_KEY,
} from "../../src/platform/opencode/auto-drive.js";
import { ExecutionAttribution } from "../../src/platform/opencode/execution-attribution.js";

import { InputAdmissions } from "../../src/platform/opencode/input-admission.js";
export async function verifiedContinuationOrigin(
	auto: AutoDriveCoordinator,
	host: string,
	inputID: string,
	assistantID: string,
	delivery: AutoDriveDelivery = {
		agent: "build",
		model: { providerID: "test", modelID: "manager" },
	},
): Promise<string> {
	const sessionID = Session.ID.make(host);
	const agent = Agent.ID.make(delivery.agent);
	const model = {
		providerID: Provider.ID.make(delivery.model.providerID),
		id: Model.ID.make(delivery.model.modelID),
		...(delivery.variant === undefined
			? {}
			: { variant: Model.VariantID.make(delivery.variant) }),
	};
	const messageID = SessionMessage.ID.make(assistantID);
	const id = CallID.make("call_fixture");
	const authority = auto.captureAuthority(host);
	const payload = {
		text: "Source-bound fixture request",
		...(authority
			? { metadata: { [FLOW_AUTO_METADATA_KEY]: authority.token } }
			: {}),
	};
	const inputs = new InputAdmissions({
		assertOpen: () => {},
		authorityCurrent: (candidate) => auto.isAuthorityCurrent(candidate),
		authority: () => auto.captureAuthority(host),
		observeReal: async () => {},
	});
	const reservation = inputs.reserve(host, inputID);
	const admission = inputs.register(reservation, { type: "user", payload });
	await inputs.accept(
		admission,
		{
			sessionID,
			id: inputID,
			type: "user",
			time: { created: 0 },
			delivery: "queue",
			payload,
		},
		async () =>
			inputs.makeOrigin(
				host,
				inputID,
				delivery,
				authority !== null,
				reservation.epoch,
			),
	);
	const user: SessionMessageInfo = {
		id: inputID,
		type: "user",
		...payload,
		time: { created: 0 },
	};
	const attribution = new ExecutionAttribution((origin) =>
		inputs.assertLive(origin),
	);
	const context: SessionContext = {
		sessionID,
		agent,
		model,
		system: [],
		options: {},
		tools: {},
		messages: [
			{
				id: inputID,
				role: "user",
				content: [{ type: "text", text: "Source-bound fixture request" }],
			},
		],
	};
	const session: SessionInfo = {
		id: sessionID,
		agent,
		model,
		projectID: "fixture",
		location: { directory: process.cwd() },
		time: { created: 0, updated: 0 },
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	};
	const operation = inputs.openSource(context);
	const resolved = await operation.resolve([user], session, {
		check: () => {},
		supersede: () => {},
	});
	const scope = resolved.scope,
		evidence = resolved.evidence;
	if (evidence.kind !== "live")
		throw new Error("Missing accepted fixture origin.");
	attribution.freeze(
		context,
		[user],
		{ kind: "flow", origin: evidence.origin },
		scope,
	);
	attribution.request({
		sessionID,
		agent,
		model,
		kind: "primary",
		request: new Request("http://localhost/fixture"),
	});
	const assistant: SessionMessageInfo = {
		id: messageID,
		type: "assistant",
		agent,
		model,
		time: { created: 1 },
		content: [
			{
				type: "tool",
				id,
				name: "flow_status",
				state: { status: "running", input: {}, metadata: {} },
				time: { created: 1 },
			},
		],
	};

	const verified = attribution.verify(
		{ sessionID, agent, messageID, id },
		[user, assistant],
		session,
		process.cwd(),
		"flow_status",
	);
	if (verified.primary.participation.kind !== "flow")
		throw new Error("Expected Flow fixture participation.");
	const origin = verified.primary.participation.origin;
	auto.observeAssistant(host, assistantID, origin.id);
	operation.release();
	inputs.clear();
	attribution.clear();
	return origin.id;
}

export function fixtureAutomaticPrompt(
	auto: () => AutoDriveCoordinator,
	observe: (
		...args: Parameters<
			import("../../src/platform/opencode/auto-drive-dispatch.js").AutomaticPrompt
		>
	) => void | Promise<void> = () => {},
	afterAdmission = false,
): import("../../src/platform/opencode/auto-drive-dispatch.js").AutomaticPrompt {
	return async (...args) => {
		const [host, text, delivery, metadata, intent] = args;
		const token = metadata[FLOW_AUTO_METADATA_KEY];
		if (typeof token !== "string") throw new Error("Missing fixture token.");
		const driver = auto(),
			id = SessionMessage.ID.create();
		const inputs = new InputAdmissions({
			assertOpen: () => {},
			authority: () => driver.captureAuthority(host),
			authorityCurrent: (authority) => driver.isAuthorityCurrent(authority),
			observeReal: async () => {},
		});
		const payload = { text, metadata: { [FLOW_AUTO_METADATA_KEY]: token } };
		const reservation = inputs.reserve(host, id),
			admission = inputs.register(reservation, { type: "synthetic", payload });
		const accept = () =>
			inputs.accept(
				admission,
				{
					sessionID: host,
					id,
					type: "synthetic",
					payload,
					time: { created: 0 },
					delivery: "queue",
				},
				async () => {
					const result = await driver.observeMessage(
						host,
						delivery,
						[{ type: "text", text, synthetic: true, metadata }],
						id,
						intent,
					);
					if (result !== "accepted-continuation")
						throw new Error("Fixture dispatch was not accepted.");
					return inputs.makeOrigin(host, id, delivery, true, reservation.epoch);
				},
			);
		try {
			if (afterAdmission) await accept();
			await observe(...args);
			if (!afterAdmission) await accept();
			return { kind: "sent", source: id };
		} finally {
			inputs.clear();
		}
	};
}
