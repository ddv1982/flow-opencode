# Pinned host accounting

OpenCode 1.18.6 normalizes output and separately reported reasoning into disjoint
categories. The
parent inspected Session.getUsage in the pinned binary at byte 67,258,290.
Its SHA-256 is 9220f579e24f5212803e1cf9c0ecb098e3d49fdb1dbfd503b756e8fa8f8238eb.
The installed binary is
`/Users/vriesd/.bun/install/cache/opencode-darwin-arm64@1.18.6@@@1/bin/opencode`.

| Recorded category | Meaning |
| --- | --- |
| input | Upstream input minus cache reads and writes, clamped nonnegative |
| output | Upstream output minus reported reasoning, clamped nonnegative |
| reasoning | Upstream reasoning |
| cache.read and cache.write | Separate cached input categories |

Generated-output consumption is output plus reasoning. Total categorized input
is input plus both cache categories. Do not add upstream total again. Count an
assistant message once, not both the message and its step-finish observation.
Missing upstream counts become zero in the host, so zero is not proof that a
failed request consumed no resources.

The normal cost path multiplies each category by model-catalog rates and charges
reasoning at the output rate. A separate Copilot metadata path also exists.
Treat the host figure as unverified cost provenance, not an invoice. Effective
service tier exists in native adapter finish metadata but is absent from the
legacy stored assistant message used by this runner.

The old harness treats zero cost as known zero when its output bucket is zero.
That is wrong for reasoning-only or input-only metered work. New accounting must
consider all observed categories and preserve uncertainty about incomplete usage.
Historical outputTokens values retain their original host-output meaning. If
upstream reasoning detail is absent, that bucket can still contain reasoning.
New budget semantics require an explicit version marker.

The same pinned binary confirms that command input accepts top-level variant
and forwards it into prompt execution. The HTTP construction is at byte
65,271,171, the CommandInput schema at 65,656,438, and forwarding at 65,655,140.
This complements the credential-free prompt_async probe. It is not provider
application or tool-call qualification.
