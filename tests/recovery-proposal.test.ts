import { expect, test } from "bun:test";
import { RecoveryProposals } from "../src/application/recovery-proposal.js";

test("proposal preparation consumes no key and only one competing exact claim commits", () => {
	const owner = new RecoveryProposals();
	const first = owner.prepare("flow/1", () => true),
		competing = owner.prepare("flow/2", () => true);
	expect(first?.text).toContain("top-level recoveryProposal");
	expect(owner.prepare("flow/1", () => true)).not.toBeNull();
	competing?.commit();
	expect(() => first?.commit()).toThrow("superseded");
	expect(owner.prepare("flow/2", () => true)).toBeNull();
	expect(() => competing?.commit()).toThrow("superseded");
	expect(owner.prepare("flow/2", () => true)).toBeNull();
});
test("an expired or replaced exact lease invalidates its prepared proposal", () => {
	const old = new RecoveryProposals();
	let valid = true;
	const claim = old.prepare("flow/1", () => valid);
	valid = false;
	expect(() => claim?.assertCurrent()).toThrow("superseded");
	expect(() => claim?.commit()).toThrow("superseded");
	const fresh = new RecoveryProposals();
	const replacement = fresh.prepare("flow/1", () => true);
	replacement?.commit();
	expect(fresh.prepare("flow/1", () => true)).toBeNull();
	expect(old.prepare("flow/1", () => true)).not.toBeNull();
});
