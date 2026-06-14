# UI quality rubric

Use this rubric for frontend planning, implementation, and review.

## Product fit

- The screen solves the user's actual task, not a generic demo of components.
- The first viewport shows the product, data, object, or workflow the user came for.
- The information density matches use: operational tools favor scannable, compact structure; expressive pages need stronger visual identity and media.
- Navigation and primary actions are obvious without explanatory helper text.

## Visual design

- **Typography**: hierarchy is clear; font choices fit the product; body text remains readable; compact surfaces do not use hero-scale type.
- **Color**: palette has a coherent role system; contrast is sufficient; accent colors guide attention; avoid one-note palettes and generic purple-blue gradients unless the brand requires them.
- **Composition**: alignment, spacing, and grouping make comparison easy; repeated items are consistent; page sections are not nested decorative cards.
- **Controls**: use familiar controls for the job: icons for common tools, toggles for binary settings, segmented controls for modes, sliders/inputs for numbers, menus for option sets.
- **Motion**: animation clarifies state or creates a focused moment; it does not hide latency, distract from work, or ignore reduced-motion needs.
- **Imagery/media**: when the subject matters, show the actual product/place/object/state rather than atmospheric filler.

## Interaction and states

- Loading, empty, error, disabled, hover, focus, selected, and validation states exist for the changed workflow.
- Long strings, missing data, large numbers, and small screens do not break layout.
- Destructive actions have appropriate confirmation or undo patterns.
- Form errors are close to the field and clear enough to fix.
- Async state cannot double-submit, lose edits, or leave stale UI behind.

## Accessibility baseline

- Interactive elements are semantic or have correct roles and labels.
- Keyboard users can reach and operate controls in a logical order.
- Focus indicators are visible.
- Text and essential UI meet contrast expectations.
- Status, error, and progress messages are not conveyed by color alone.
- Motion respects reduced-motion preferences when substantial.

## Review finding shape

```text
class; severity; location or screenshot area; evidence inspected; user impact; fix shape; visual/validation evidence needed
```

Blocking UI findings are issues that prevent task completion, hide required information, break accessibility basics, create incoherent layout at supported sizes, or make the visual success claim unverifiable.
