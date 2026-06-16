---
name: flow-ui-quality
description: Review and improve frontend UI quality for Flow work. Use for UX/UI design, frontend polish, visual quality review, responsive and accessible interfaces, interaction states, screenshots, browser-verified UI work, and avoiding generic AI-generated UI.
---

# Flow UI quality

Use this skill when Flow work changes what a user sees or how they interact with an interface. The goal is production UI quality: useful, coherent, accessible, responsive, and visually intentional.

## Establish the interface intent

- Identify the user, job-to-be-done, primary workflow, density needs, device constraints, and brand/product tone before choosing visuals.
- Choose a clear design direction that fits the product context. Distinctive does not mean decorative; utilitarian tools can be excellent through restraint, hierarchy, and speed.
- Load `references/ui-rubric.md` for design and UX review criteria.
- Load `references/visual-verification.md` before completing meaningful UI changes to capture visual evidence. During review, use it to assess recorded evidence; only run browser checks yourself if the current agent and tools permit it.
- Record design constraints and verification expectations in Flow plan fields: `requirements`, `decisions`, feature `targets`, and feature `validation`. Do not add new Flow payload fields.

## Build with visual intent

- Use existing design systems, component libraries, tokens, icons, and layout conventions before inventing new primitives.
- Make typography, spacing, color, motion, and hierarchy deliberate. Avoid default-looking AI output: centered everything, purple gradients, generic cards, uniform oversized radii, stock SaaS layouts, and unexamined Inter/system-font sameness.
- Match composition to domain: operational apps need scanability, alignment, predictable controls, efficient density, and clear states; marketing or editorial surfaces can carry more expressive imagery and motion.
- Include states a real user will hit: loading, empty, error, disabled, hover, focus, selected, validation, and long content.
- Protect accessibility: semantic controls, labels, focus order, keyboard reachability, contrast, reduced-motion behavior, and non-color-only status.

## Verify visually

- For meaningful UI changes, run the app and capture screenshots when a local browser target is available.
- For browser-driven QA, route selection, failure classification, and
  `validationRun` summaries, load `flow-test`. Keep visual judgment, design
  quality, and screenshot assessment in `flow-ui-quality`.
- Check desktop and mobile breakpoints, not only the viewport you developed in.
- Verify text does not overlap, truncate unintentionally, or escape controls; long labels and empty/error states must fit.
- Compare against provided screenshots, design references, or the stated product intent. List meaningful differences and fix the ones that violate the goal.
- If browser verification cannot run, record the gap and the next-best evidence such as component tests, Storybook snapshots, build output, or static inspection.

## Review UI work

Approve only when the interface is both useful and inspectable:

- The main workflow is visible and efficient.
- Visual hierarchy makes the next action obvious.
- Responsive behavior is deliberate.
- Accessibility basics are covered.
- State coverage is present or the gaps are explicit.
- Screenshot/browser evidence supports the claim whenever feasible.

Never approve a UI change based only on code shape. If users will judge it visually, Flow evidence should include visual inspection.
