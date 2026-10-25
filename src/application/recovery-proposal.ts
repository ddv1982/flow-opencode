export type PreparedRecoveryProposal = Readonly<{
	text: string;
	assertCurrent(): void;
	commit(): void;
}>;
const advice =
	"Recovery advice is enabled for this process. Call flow_status with a top-level recoveryProposal containing id, sessionId, expectedRevision and at most three candidates. Each candidate needs id, action retry or independent-feature, exact featureId, remedy, changedFromPreviousAttempt and actual findingIds. Advice cannot expand the approved plan or replace evidence. In shadow mode report the advice and stop. In delegated mode call only the exact recommended existing mutation, then repeat full validation and independent review.";
export class RecoveryProposals {
	#committed: string | null = null;
	#generation = 0;
	prepare(key: string, valid: () => boolean): PreparedRecoveryProposal | null {
		if (key === this.#committed || !valid()) return null;
		const previous = this.#committed,
			generation = this.#generation;
		let committed = false;
		const assertCurrent = () => {
			if (
				committed ||
				!valid() ||
				this.#committed !== previous ||
				this.#generation !== generation
			)
				throw new Error("Flow recovery proposal was superseded.");
		};
		return Object.freeze({
			text: advice,
			assertCurrent,
			commit: () => {
				assertCurrent();
				committed = true;
				this.#committed = key;
				this.#generation++;
			},
		});
	}
}
