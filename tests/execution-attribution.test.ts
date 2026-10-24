import { expect, test } from "bun:test";
import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import { Agent, Model, Provider } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { CallID } from "@opencode/plugin/promise/tool";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import {
	ExecutionAttribution,
	type InputOrigin,
} from "../src/platform/opencode/execution-attribution.js";

const sid = Session.ID.make("session-test");
const model = {
	providerID: Provider.ID.make("local"),
	id: Model.ID.make("scripted"),
};
const agent = Agent.ID.make("build");
const origin: InputOrigin = {
	id: "user-1",
	epoch: 0,
	automatic: false,
	authority: null,
	delivery: {
		agent,
		model: { providerID: model.providerID, modelID: model.id },
	},
};
const user: SessionMessageInfo = {
	type: "user",
	id: "user-1",
	text: "Approved task",
	time: { created: 0 },
};
const assistant: SessionMessageInfo = {
	type: "assistant",
	id: "msg_assistant1",
	agent,
	model,
	time: { created: 1 },
	content: [
		{
			type: "tool",
			id: "call-1",
			name: "shell",
			state: { status: "running", input: {}, metadata: {} },
			time: { created: 1 },
		},
	],
};
const context: SessionContext = {
	sessionID: sid,
	agent,
	model,
	system: [],
	options: {},
	tools: {},
	messages: [
		{
			id: "user-1",
			role: "user",
			content: [{ type: "text", text: "Approved task" }],
		},
	],
};
const session: SessionInfo = {
	id: sid,
	projectID: "project",
	agent,
	model,
	cost: 0,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	time: { created: 0, updated: 0 },
	location: { directory: "/tmp" },
};
const execution = {
	sessionID: sid,
	agent,
	messageID: SessionMessage.ID.make("msg_assistant1"),
	id: CallID.make("call-1"),
};
function fixture() {
	let live = true;
	const attribution = new ExecutionAttribution(() => {
		if (!live) throw new Error("revoked epoch");
	});
	const primary = attribution.freeze(context, [user], origin);
	const request = new Request("http://localhost/primary");
	attribution.request({
		sessionID: sid,
		agent,
		model,
		kind: "primary",
		request,
	});
	return {
		attribution,
		primary,
		request,
		revoke() {
			live = false;
		},
	};
}
test("native exact execution binds once and a revoked epoch vetoes its second boundary", () => {
	const f = fixture();
	expect(
		f.attribution.verify(execution, [user, assistant], session, "/tmp", "shell")
			.primary.origin.id,
	).toBe("user-1");
	f.revoke();
	expect(() =>
		f.attribution.verify(
			execution,
			[user, assistant],
			session,
			"/tmp",
			"shell",
		),
	).toThrow("revoked epoch");
});
test("native full prefix, exact call, agent, and workspace are required", () => {
	for (const [messages, call, identity, workspace] of [
		[[{ ...user, id: "other-user" }, assistant], execution, session, "/tmp"],
		[
			[user, assistant],
			{ ...execution, id: CallID.make("wrong-call") },
			session,
			"/tmp",
		],
		[[user, assistant], execution, { ...session, agent: "other" }, "/tmp"],
		[[user, assistant], execution, session, "/different-workspace"],
	] as const)
		expect(() =>
			fixture().attribution.verify(
				call,
				messages,
				identity,
				workspace,
				"shell",
			),
		).toThrow();
});
test("overlapping primary context is refused", () => {
	const f = fixture();
	expect(() => f.attribution.freeze(context, [user], origin)).toThrow(
		"overlap",
	);
});
test("response must join the same Request object", () => {
	const f = fixture();
	expect(() =>
		f.attribution.response(
			{
				sessionID: sid,
				agent,
				model,
				kind: "primary",
				request: new Request(f.request),
				response: new Response("data"),
			},
			() => {},
		),
	).toThrow("Request identity");
});
test("an old assistant is rejected after a later context", async () => {
	const f = fixture();
	f.attribution.verify(execution, [user, assistant], session, "/tmp", "shell");
	const response = {
		sessionID: sid,
		agent,
		model,
		kind: "primary" as const,
		request: f.request,
		response: new Response("data"),
	};
	f.attribution.response(response, () => {});
	expect(await response.response.text()).toBe("data");
	f.attribution.freeze(context, [user, assistant], origin);
	f.attribution.request({
		sessionID: sid,
		agent,
		model,
		kind: "primary",
		request: new Request("http://localhost/next"),
	});
	expect(() =>
		f.attribution.verify(
			execution,
			[user, assistant],
			session,
			"/tmp",
			"shell",
		),
	).toThrow("exact assistant");
});

test.each([false, true])(
	"HTTP 400 preserves the native provider error and releases authority when already revoked is %s",
	async (alreadyRevoked) => {
		const f = fixture();
		if (alreadyRevoked) f.revoke();
		const original = Response.json(
			{
				error: {
					message: "Local scripted provider failed",
					code: "fixture_error",
				},
			},
			{ status: 400, headers: { "x-fixture-error": "original" } },
		);
		const input = {
			sessionID: sid,
			agent,
			model,
			kind: "primary" as const,
			request: f.request,
			response: original,
		};
		expect(() => f.attribution.response(input, () => f.revoke())).not.toThrow();
		expect(input.response).toBe(original);
		expect(input.response.status).toBe(400);
		expect(input.response.headers.get("x-fixture-error")).toBe("original");
		expect(await input.response.json()).toEqual({
			error: {
				message: "Local scripted provider failed",
				code: "fixture_error",
			},
		});
		expect(() =>
			f.attribution.verify(
				execution,
				[user, assistant],
				session,
				"/tmp",
				"shell",
			),
		).toThrow("revoked epoch");
	},
);

test("a failed HTTP response does not leave the next fresh request overlapping", () => {
	let current = "user-1";
	const attribution = new ExecutionAttribution((candidate) => {
		if (candidate.id !== current) throw new Error("revoked origin");
	});
	attribution.freeze(context, [user], origin);
	const request = new Request("http://localhost/failed");
	attribution.request({
		sessionID: sid,
		agent,
		model,
		kind: "primary",
		request,
	});
	attribution.response(
		{
			sessionID: sid,
			agent,
			model,
			kind: "primary",
			request,
			response: Response.json(
				{ error: { message: "Local scripted provider failed" } },
				{ status: 400 },
			),
		},
		() => {
			current = "user-2";
		},
	);
	const nextUser: SessionMessageInfo = {
		...user,
		id: "user-2",
		text: "Fresh direction",
	};
	const nextContext: SessionContext = {
		...context,
		messages: [
			...context.messages,
			{
				id: "user-2",
				role: "user",
				content: [{ type: "text", text: "Fresh direction" }],
			},
		],
	};
	const nextOrigin: InputOrigin = { ...origin, id: "user-2" };
	attribution.freeze(nextContext, [user, nextUser], nextOrigin);
	attribution.request({
		sessionID: sid,
		agent,
		model,
		kind: "primary",
		request: new Request("http://localhost/fresh"),
	});
	expect(
		attribution.verify(
			execution,
			[user, nextUser, assistant],
			session,
			"/tmp",
			"shell",
		).primary.origin.id,
	).toBe("user-2");
});

function failedStreamFixture() {
	let direction = "user-1";
	const failures: string[] = [];
	const attribution = new ExecutionAttribution((candidate) => {
		if (candidate.id !== direction) throw new Error("revoked stream origin");
	});
	attribution.freeze(context, [user], origin);
	const request = new Request("http://localhost/stream");
	attribution.request({
		sessionID: sid,
		agent,
		model,
		kind: "primary",
		request,
	});
	return {
		attribution,
		request,
		failures,
		fail(host: string) {
			failures.push(host);
			direction = "user-2";
		},
		steer() {
			direction = "user-2";
		},
		fresh() {
			const nextUser: Extract<SessionMessageInfo, { type: "user" }> = {
				id: "user-2",
				type: "user",
				text: "Fresh real direction",
				time: { created: 2 },
			};
			const oldAssistant: Extract<SessionMessageInfo, { type: "assistant" }> = {
				id: execution.messageID,
				type: "assistant",
				agent,
				model,
				content: [],
				finish: "error",
				time: { created: 1 },
			};
			const nextContext: SessionContext = {
				...context,
				messages: [
					...context.messages,
					{
						id: nextUser.id,
						role: "user",
						content: [{ type: "text", text: nextUser.text }],
					},
				],
			};
			const nextOrigin: InputOrigin = { ...origin, id: nextUser.id };
			const native: SessionMessageInfo[] = [user, oldAssistant, nextUser];
			attribution.freeze(nextContext, native, nextOrigin);
			attribution.request({
				sessionID: sid,
				agent,
				model,
				kind: "primary",
				request: new Request("http://localhost/fresh"),
			});
			const freshID = SessionMessage.ID.make("msg_fresh");
			const freshAssistant: SessionMessageInfo = { ...assistant, id: freshID };
			return () =>
				attribution.verify(
					{ ...execution, messageID: freshID },
					[...native, freshAssistant],
					session,
					"/tmp",
					"shell",
				).primary.origin.id;
		},
	};
}

test.each([
	"cancel",
	"read-error",
	"no-body",
	"locked-body",
	"stale-response",
] as const)(
	"%s terminates its exact primary so fresh real input can execute",
	async (failure) => {
		const f = failedStreamFixture();
		const response =
			failure === "no-body"
				? new Response(null)
				: failure === "read-error"
					? new Response(
							new ReadableStream({
								start(controller) {
									controller.error(new Error("provider stream broke"));
								},
							}),
						)
					: failure === "cancel"
						? new Response(new ReadableStream())
						: new Response("body");
		const input = {
			sessionID: sid,
			agent,
			model,
			kind: "primary" as const,
			request: f.request,
			response,
		};
		const locked =
			failure === "locked-body" ? response.body?.getReader() : undefined;
		if (failure === "stale-response") f.steer();
		if (
			failure === "no-body" ||
			failure === "locked-body" ||
			failure === "stale-response"
		) {
			expect(() => f.attribution.response(input, f.fail)).toThrow();
			locked?.releaseLock();
		} else {
			f.attribution.response(input, f.fail);
			if (failure === "read-error")
				await expect(input.response.text()).rejects.toThrow(
					"provider stream broke",
				);
			else {
				if (!input.response.body) throw new Error("Missing native body.");
				await input.response.body.cancel("real steer");
			}
		}
		const verifyFresh = f.fresh();
		expect(verifyFresh()).toBe("user-2");
		expect(f.failures).toEqual(["session-test"]);
	},
);

test("a late old-stream cancellation failure cannot end or revoke a newer primary", async () => {
	const f = failedStreamFixture();
	const cancelled = Promise.withResolvers<void>();
	const input = {
		sessionID: sid,
		agent,
		model,
		kind: "primary" as const,
		request: f.request,
		response: new Response(
			new ReadableStream({ cancel: () => cancelled.promise }),
		),
	};
	f.attribution.response(input, f.fail);
	if (!input.response.body) throw new Error("Missing wrapped body.");
	const pending = input.response.body.cancel("steer");
	const verifyFresh = f.fresh();
	cancelled.reject(new Error("late native cancel failure"));
	await expect(pending).rejects.toThrow("late native cancel failure");
	expect(verifyFresh()).toBe("user-2");
	expect(f.failures).toEqual(["session-test"]);
	const late = { ...input, response: new Response("late duplicate response") };
	expect(() => f.attribution.response(late, f.fail)).toThrow(
		"Request identity",
	);
	expect(verifyFresh()).toBe("user-2");
	expect(f.failures).toEqual(["session-test"]);
});
