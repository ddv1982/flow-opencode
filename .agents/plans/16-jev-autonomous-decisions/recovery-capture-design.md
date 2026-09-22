# Private recovery input capture

## Problem

The reviewed dataset workflow requires the exact session, source digest, and
proposal at the recovery boundary. Reading the session after a tool finishes can
capture a different revision. The existing response collector starts from an
assembled corpus and cannot supply those missing inputs.

## Decision

Use an evaluation-only controller that decorates `RecoveryGuard.propose`.
`createFlowService` already supplies the complete transaction-loaded payload to
that method. The existing plugin factory accepts a controller factory, so this
approach requires no new production service callback.

The capture plugin uses an unavailable decision provider. It cannot call Jev or
read its credentials. Operators explicitly select this plugin instead of the
ordinary Flow plugin. Manager inference still belongs to the host and needs its
own authorization.

The record is a raw, unreviewed input with unverified origin. It retains the
payload, a canonical payload digest, capture time, and tool context. Capturing
precedes controller validation. A record can therefore describe a rejected
proposal. It does not establish eligibility, execution, source authenticity,
representativeness, sanitization, or independent review.

The recorder claims a new private directory outside the canonical workspace.
Each attempt uses a separate exclusive file. Finite count and byte limits bound
one recorder. A write failure stops the opted-in proposal before assessment.
Default plugin behavior remains unchanged.

## Alternatives

| Design | Benefit | Cost |
| --- | --- | --- |
| Service callback | Explicit capture at the transaction boundary | Threads a new dependency through application, workspace, tools, and plugin composition |
| Evaluation guard wrapper | Uses the existing complete input boundary | Requires an evaluation-only controller subclass and alternate plugin selection |

Two independent designs and a separate judge selected the wrapper. Model and
reasoning settings were inherited. Model diversity was not verified. The service
callback candidate contributed tests for unchanged input and failure before
delegation. A later filesystem export lost because it cannot recover the exact
input revision. A provider wrapper lost because its packet omits original input.

## Review and verification

Boundary tests must compare retained payloads with the actual service input,
exercise storage failures and limits, and reject raw captures at dataset import.
Plugin tests must exercise the actual registered tool. Native loader verification
and direct tool invocation are separate claims unless one native run proves the
whole capture path.

The existing dataset import, label review, and corpus validation remain the path
for sanitized evidence. No capture automatically becomes a reviewed case.

The final native check used the documented source URI on OpenCode 1.18.31. A
loopback scripted manager invoked `flow_status` and produced one exact raw record.
The parent inspected the retained transcript and capture. No paid inference ran.
