# Flow 10.0.4 model-picker patch

The maintainer approved full-send merge and a new release through release CI on
2026-10-30, without new model qualification. Flow's terminal keymap layer
implicitly used base mode. It loaded successfully but was hidden in prompt and
palette modes. Set the existing layer to global; model choices and runtime gates
stay unchanged.

Use the exact-version baseline-qualified patch route against measured 10.0.2.
The record seals the inherited home-startup files and the picker file, comparing
all three directly to measured source fdd11b7d. Dependencies, build settings,
guidance, permissions, schema and lifecycle behavior are unchanged. Historical
80/81 matrix and 6/6 canary results remain historical, with no candidate model
measurement. Other versions and runtime paths require full qualification.

Proof: reproduce missing palette entry with published 10.0.3; confirm both
palette/slash discovery and the planning/reviewer dialog after the fix in an
isolated terminal without a model prompt. Add a regression that fails without
global mode. Run pinned toolchain checks, packed native smoke, replay and strict
release initialization; obtain independent Sol review before pushing. CI and the
existing guarded Release workflow own publication of the exact sealed tarball.

Dependabot #213 and #214 remain separate because this offline path requires
unchanged dependency and lockfile bytes. The unrelated intermittent MCP
execution-attribution failure is outside this UI fix.
