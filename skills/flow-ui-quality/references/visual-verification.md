# Visual verification workflow

Use this workflow when UI changes can be run locally. Flow execution may create visual evidence; Flow review usually assesses recorded evidence because the reviewer is read-only.

## Execution lane

- Identify the target route, state, viewport sizes, and any required seed data.
- Start the repo's normal dev server or storybook command from the recorded repo profile.
- Prefer existing browser or Playwright tooling when available. Do not add heavy visual tooling just to inspect a small change.
- Capture at least one desktop viewport and one mobile viewport for user-facing layout changes.
- Exercise the primary interaction changed by the feature.
- Inspect loading, empty, and error states when they are part of the changed workflow or easy to reach.
- Check browser console output when the tooling exposes it.
- For canvas/3D/media-heavy UI, verify rendered pixels are nonblank and the subject is framed.

## Review lane

- Inspect the screenshots, browser notes, console output, or visual artifacts recorded by execution.
- Compare recorded evidence against the plan's design intent, supported viewports, state coverage, and the UI rubric.
- If the current reviewer has browser/shell tools and permissions, it may perform additional read-only visual checks.
- If the reviewer is read-only without browser or shell access, do not try to recreate evidence. Treat missing or insufficient visual evidence as a finding or coverage gap.

## What to look for

- Text overlap, clipped labels, unintended wrapping, and controls resizing on hover.
- Incoherent spacing, nested cards, generic placeholder visuals, and decorative elements that compete with the task.
- Missing focus states, low contrast, unreachable controls, and color-only status.
- Broken responsive behavior: horizontal scroll, collapsed controls, hidden primary actions, or unreadable tables.
- State bugs: stale loading indicators, duplicate submissions, lost input, or errors that cannot be recovered.

## If visual verification is unavailable

Record the reason and use the strongest available substitute:

- build/typecheck/lint for changed frontend code.
- component or interaction tests.
- Storybook/static render output.
- code inspection against existing component patterns.

Do not claim visual polish was verified if no visual artifact was inspected.
