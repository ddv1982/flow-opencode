# Flow v2 Tool Contract Migration

Flow v2 is canonical-first.

## Canonical tools

- `flow_review_record_feature`
- `flow_review_record_final`
- `flow_run_complete_feature`
- `flow_reset_feature`

## Removed raw-wrapper tools

These compatibility shims were part of the v2 migration and are now removed from the active tool surface:

- `flow_review_record_feature_from_raw`
- `flow_review_record_final_from_raw`
- `flow_run_complete_feature_from_raw`

## Mapping

| Deprecated v2 tool | Canonical replacement |
| --- | --- |
| `flow_review_record_feature_from_raw` | `flow_review_record_feature` |
| `flow_review_record_final_from_raw` | `flow_review_record_final` |
| `flow_run_complete_feature_from_raw` | `flow_run_complete_feature` |

## Behavioral notes

- final-path completion always requires final review
- runtime recovery metadata emits canonical tool names only

## Current state

- canonical-only public tool surface
- runtime recovery metadata emits canonical tool names only
- prompt guidance no longer references raw-wrapper fallback paths
