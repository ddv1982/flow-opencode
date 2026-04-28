/**
 * Flow runtime transition owner: completion gating and recovery prerequisites
 * remain normative here.
 *
 * Protected subsystem:
 * - completion gate order
 * - lite-lane completion/retry behavior
 * - replan vs blocked vs ready transition semantics
 * - recovery metadata linkage
 *
 * If this file changes, run:
 * `bun run check:completion-lane`
 */

export {
	completeExecutionRun,
	markSessionCompleted,
} from "./execution-completion-finalization";
export type { WorkerOutcomeKind } from "./execution-completion-normalization";
export { validateSuccessfulCompletion } from "./execution-completion-validation";
