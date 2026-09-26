# Isolated live treatment admission

The evaluation host currently treats every recovery treatment as a simulation.
It installs synthetic OAuth credentials and a scripted transport. Live treatment
admission needs a separate entry before that host can support real providers.

The new entry composes the existing request gate, Flow plugin, recovery controller,
and Jev adapter. It does not enable live episodes or qualify production recovery.

## Composition choice

Two independent designs compared separate live admission against one entry that
installs the budget gate itself. Both rejected a ready file as admission authority.
A matching PID and digest in a file do not prove that fetch interception is active.

The selected design uses one entry and keeps its strict options in the same module.
This removes plugin ordering from the caller's responsibilities. The execution
scope supplies the arm, so callers cannot provide conflicting arm values.
The independent judge agreed with this choice.

The other design contributed support for both arms, a missing-key check before
gate installation, and checks of both fetch and WebSocket interception identities.
The manager-only arm uses a provider that cannot dispatch Jev requests. It does
not need a Jev credential. The Jev arm uses the existing adapter and a fixed
experimental profile. These thresholds are not calibrated or release-qualified.

## Admission boundary

Live options require a request authorization digest, ledger directory, supported
manager, and execution scope. Simulation scripts, arbitrary thresholds, and secret
values do not belong in plugin options. Authorization must be live, current,
uncancelled, and bound to the selected manager. Treatment also requires a Jev
reservation bound. The other manager cannot share this campaign authorization.

The budget plugin owns the installed gate identity. The live entry installs that
gate directly and checks its in-memory binding and active global functions.
Readiness files remain output evidence. A replaced gate prevents later Jev
assessment. Request reservations still enforce expiry, cancellation, and shared
spending limits at dispatch time.

The assertion is a property of the default budget plugin function. It is not a
separate module export that OpenCode could invoke as another plugin entry.

Failed startup leaves interception installed. Restoring the original fetch would
permit unmetered traffic. Failed budget readiness publication prevents subsequent
reuse in that process. An isolated host must terminate after startup failure.

## Verification boundary

Tests invoke the actual plugin in isolated Bun processes with an allowlisted
environment, a synthetic credential, and intercepted transport. They drive the
Flow command and tool hooks through the existing controller and real Jev adapter.
The transport checks that the scoped reservation exists before receiving a request.
Control cases must produce no Jev request.

This proves plugin admission and adapter composition. Native OpenCode loading,
host credential wiring, and live episode execution remain separate work. No test
authorization establishes real provider pricing or permits paid calls.

## Limits

In-process identity checks detect accidental replacement. They are not a security
boundary against hostile code in the same process or an operating-system network
sandbox. Scope validation binds supplied identifiers. It does not independently
authenticate the registration or its operational evidence.

The production qualification registry remains empty. Operational cases,
independent review, real cost bounds, a new explicit campaign cap, live host
integration, and qualification remain required.
