# Live episode runner admission

The native host can load the isolated live plugin, but the runner previously
rejected every live origin. The runner now requires an explicit driver admission
capability, frozen host artifacts, and reservation reconciliation. Ordinary packed
hosts and generic drivers do not acquire live admission implicitly.

The existing native driver supplies admission only for explicit live treatment.
Before journal creation or startup it checks the registered scope, manager and
prompt, task, initial state, and completion criteria against the snapshotted host
configuration. The runner validates the registered composed harness identity and
passes that scope unchanged through admission, preparation, and accounting; a
wrapper may extend the native driver identity. It requires explicit credential policy, a Jev toolchain key for
treatment, and a current, matching live request ledger with reviewed bounds and
remaining capacity for each required model. Budget paths are resolved when the
driver is created. Admission neither sends requests nor consumes reservations.

The existing lifecycle performs preparation, artifact and reset verification,
execution, shutdown, and scoped reconciliation. Native plugin startup revalidates
the budget. Individual requests retain atomic reservations and dispatch-time
cancellation/expiry checks. Admission cannot promise funding for the whole episode
or prevent another host from consuming the remaining cap. Command dispatch keeps
its separate FLOW_EVAL_AUTHORIZATION requirement.

An optional method keeps simulation drivers compatible and avoids a second
lifecycle or new authorization format. Drivers are trusted local code, including
injected test factories. This API is not a security boundary against a malicious
driver. Reviewer identities and cost evidence remain attestations. No real review,
price evidence, credential, or paid authorization is created by these changes.

Local tests use synthetic live-format budgets and an injected host. They exercise
both managers and both arms through run, completion, shutdown, scoped accounting,
and journal recovery. They do not prove actual model behavior or provider costs.
Production profiles remain empty. Representative data, independent reviews,
explicit campaign approval, real comparisons, and release qualification remain.
