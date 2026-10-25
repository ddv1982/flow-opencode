# Capture error reporting

Sentry discussion 4369391412 identified a real v2 reporting regression. The
completed shell could succeed while Flow capture failed, leaving the model with
only raw shell output. The host log contained the exception. No validation
receipt was fabricated.

The parent reproduced this on the exact `c38dc14e` candidate and native OpenCode
2.1.4. Plan save, approval, run start and validation arming all succeeded before
the disposable command deliberately made its own session JSON unreadable. The
shell exited zero; the next model request contained only its literal output.
The first wrong-platform setup attempt remains excluded from that proof.

The fix adds a static `[flow-validation-error]` notice to completed v2 content.
It preserves existing text or file parts, metadata and structured output.
Detailed errors remain in the existing log. The notice says no validation
receipt was produced; it does not claim a write could never partially persist.
Native error objects remain unchanged because v2 can render a nested cause
instead of an outer message. Stale null refusals and unrelated calls remain
silent. The marker grants no validation, receipt or continuation authority.

The regression was committed first as `3a51aba7`. Five visibility cases failed
before the fix while three guards passed. The same eight cases pass afterward.
The parent passed all 157 focused cases. Independent OpenAI source review and
comment review pass. The production change is 12 lines in the existing catch,
with no new production helper, state or API.

The component persistence probe uses a regular lock file and preserves sentinel
durable bytes. That differs from the intentionally corrupted native fixture,
which does not preserve a valid session document. SDK-optional absent content is
tested for field preservation only. It is not native fallback qualification.

The parent must replay the same corrected native driver on a new exact archive
and require the notice in both durable native tool content and the next model
request, with no false validation receipt. Full contribution gates precede push.
Paid qualification, merge and publication remain on hold.

Local evidence is under `/tmp/flow-v2-capture-error-20261025/`. The source review
is `source-review-r1/review.md`, the accepted native before receipt is
`parent-native/before-accepted.json`, and the unchanged before/after driver is
`parent-native/driver-corrected.ts`. Parent package and native-after evidence
retain their own identities.
