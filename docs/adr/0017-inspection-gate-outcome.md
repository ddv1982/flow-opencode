# ADR 0017: Observed inspection gates

An inspection can succeed by reporting a failed audit honestly. Requiring its
audit command to pass made an inspection-only Flow session impossible to review
or close when the defect being reported was the audit failure. Replanning around
the audit hid the reason for the stop.

Add `scope: "gate-observe"`. Existing `gate` keeps the prior pass rule.
The new scope is allowed only on the canonical gate of an all-inspect plan, with no
named passing assertions. Its latest result must have a known exit code,
complete output, current source, and the declared host. A failed exit remains
failed in the reviewer projection and terminal delivery. A change plan cannot
use this mode. This adds no authority to repair dependencies or product files.
