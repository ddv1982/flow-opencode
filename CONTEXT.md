# Flow Runtime Context

Flow coordinates one planned delivery through validation, independent review,
and archival while keeping lifecycle identity explicit and recoverable.

## Versions

**Flow v5**:
The current product and runtime generation. It is distinct from the version of
the session document it operates on.
_Avoid_: Session v5, schema v5

**Session v4**:
The sole supported session-document contract for Flow v5.
_Avoid_: Flow v4, current session, legacy session

## Execution and review

**Active execution**:
The one currently actionable pairing of a planned feature and its execution
epoch. The pairing exists or is absent as a unit.
_Avoid_: Active feature, active run, current work

**Review assignment**:
A durable, runtime-owned identity and bounded scope created before independent
review begins.
_Avoid_: Review request, reviewer task, review packet

**Assignment result**:
The reviewer's reported verdict and findings for one review assignment.
_Avoid_: Review completion, review evidence, review payload

**Bound prerequisite result**:
A passing feature-assignment result retained to authorize a later final review
without yet becoming recorded review history.
_Avoid_: Feature review cache, provisional approval, prerequisite digest

**Recorded review execution**:
An assignment result accepted into durable review history as part of an atomic
feature outcome.
_Avoid_: Submitted assignment, stored verdict, completed review

**Reported time**:
A time claimed by an external validation or reviewer result.
_Avoid_: Trusted time, completion time

**Runtime acceptance time**:
The runtime-owned time at which Flow accepts a lifecycle operation.
_Avoid_: Reported time, client time, current time

## Closure and recovery

**Closure**:
The durable terminal disposition that ends ordinary changes to a session.
_Avoid_: Archive, feature completion, session completion

**Archive publication**:
The act of publishing a closed session into durable history.
_Avoid_: Closure, close request, cleanup

**Archive-recovery session**:
A closed, quiescent session whose archive publication has not yet converged.
_Avoid_: Active session, partially closed session, stuck archive

**Retry handle**:
The durable, workspace-history-unique identity of an accepted operation that
authorizes continuation of its interrupted side effects without creating
another lifecycle mutation.
_Avoid_: Replay envelope, reconstructed request, retry payload
