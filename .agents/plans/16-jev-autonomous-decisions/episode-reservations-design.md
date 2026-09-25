# Episode reservation accounting

## Problem

The shared request gate reserves spending before transport. Its claims previously
had no episode identity. The episode runner produced no reservation events, so
completed simulations reported unknown spending. Counting claims before and after
an episode cannot assign costs when several hosts share one campaign budget.

## Decision

Store an immutable execution scope in the same atomic file as each reservation.
The runner creates the scope after validating registration and before host startup.
A unique execution ID distinguishes repeated attempts for the same episode and arm.
The registered harness digest remains independent of that runtime ID.

The runner validates the registered driver identity. A native driver preserves
that identity through composition, including test wrappers. The budget plugin
binds its process readiness receipt to the same scope and refuses a second scope
in the same process. Historical unscoped claims remain readable.

After confirmed host shutdown, the driver reads the validated shared ledger and
selects claims with its exact scope. The runner retains those claims in a final
journal reconciliation event. Recovery validates the retained bindings and integer
sum without reading a campaign ledger that other hosts may still extend.

Complete accounting requires successful gated startup, confirmed shutdown, valid
reconciliation, and a terminal event. Missing capability or reconciliation failure
preserves unknown spending. Reconciliation failure does not change a completed
task into a failed task. Reservations remain consumed after transport failures or
cancellation. Accounting uses integer microdollars until the report boundary.

The final event timestamp is captured before reconciliation. Reading and retaining
accounting evidence therefore adds no measured active runtime.

## Alternatives

| Design | Benefit | Cost |
| --- | --- | --- |
| Attribution in shared claims | One durable write records reservation and ownership | Extends the claim format and host configuration |
| Separate host intent stream | Own storage per host | Needs a second durable write and a unique claim ID for crash-safe joins |

Two isolated designs and an independent judge selected direct attribution. The
separate-stream design contributed explicit failure handling and retained evidence
requirements. A callback after reservation was rejected because cancellation can
occur after publication but before the reservation function returns.

Models and reasoning settings were inherited. Model diversity was not verified.

## Limits

These totals are conservative reservations, not invoices. Simulation totals use
synthetic prices. Hashes detect inconsistent retained content but do not authenticate
a hostile writer who can replace both claims and journals. Completeness relies on
one native host owning each scope and confirmed shutdown of that host.

The change does not authorize paid inference, provide reviewed OAuth pricing,
enable live episodes, or populate production qualification profiles.
