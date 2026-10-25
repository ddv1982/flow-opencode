# Queued native completion proof

This supersedes the two-idle acceptance requirement recorded in
[queued input review](queued-input-review.md). It changes the evidence contract,
not production behavior. The original failing gate remains preserved.

OpenCode 2.1.4 settles an execution drain after processing its queued inputs.
The pinned runner and projector show that idle records describe that settlement.
They do not promise one idle per prompt. The successful queue run has one
closing succeeded idle after both inputs complete.

The corrected contract keeps the request counts, exact input receipts, literal
tool results, application success, runtime identity and cleanup checks. It also
requires the original turn's completed error-free stop assistant before the
queued native user, the original second request replaying its shell result,
the queued request replaying that terminal text, and a matching successful root
settlement. Every retained idle must succeed. A final succeeded root alone is
insufficient.

The exact new archive is
`sha256:a1f47a5086e237be0051ba7eacebfd6147893b7a9756a2392e3b01f0e03cfe9f`.
Its unpacked manifest is
`sha256:a390dc144123c871d6755b10f911bf8a0c23fdcca4daea4016f58701ddfac67f`.
The loaded server entry is
`sha256:51d620aec23ec37a3d86fb755c0b244fc61f21c3eacb8880d3f4857e78781c6f`.
All 12 installed files and 81 server plus five TUI map rows match the archive.
Those rows cover 83 unique paths. All 27 frozen source and documentation paths
match before and after native testing.

The unchanged native driver observed original and queued request counts of
two and two. The literal shell completed with exit zero. The queued real
`flow_status` returned application status `ok`. All four assistants completed
without errors. Steer retained its separate one-and-two request control.
The candidate host and runner were awaited and confirmed stopped. No account
credentials or paid calls were used.

An independent OpenAI adjudication verified the binary source and retained
trace. Its 78-check proposed contract passes the candidate and rejects the
baseline on eight checks. The parent reran it independently. Seven altered
evidence controls are rejected. A successful intermediate idle remains valid.
The original candidate gate remains failed on its two-idle assumption. Both
old and new driver logs retain duplicate-release cleanup messages, which do not
represent failed native assistants or execution idles.

The same archive passed the unchanged native smoke's 119 assertions. Fresh core
and dispatch source reviews pass. Full source checks passed 4,958 tests with
27 skips and zero failures. These are synthetic compatibility checks. Paid
qualification remains on hold, and no original paid failure was reclassified.
The previously recorded host arbitration, overlap, auxiliary-retry and
intake-only observation limits remain.

Evidence is under `/tmp/flow-v2-queued-input-20261025/`. The independent report is
`native-idle-contract-review-r1/review.md`; the parent rerun is
`parent-native-contract-r1/verification.json`. The accepted contract is recorded
separately in `candidate-r1/queue-native-drain-acceptance.json`. This proof record
is added after the measured source snapshot; it does not change packaged bytes.
