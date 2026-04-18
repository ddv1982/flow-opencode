# Benchmark Baseline

Environment: `bun 1.3.5` on Apple M4 (`~3.83 GHz`)

| Benchmark | Measurement |
| --- | --- |
| session save round-trip | 1.91 ms avg |
| transition reducer / applyPlan | 19.97 µs avg |
| transition reducer / approvePlan | 49.06 µs avg |
| transition reducer / startRun | 77.63 µs avg |
| transition reducer / completeRun | 139.61 µs avg |
| markdown render / index | 3.52 µs avg |
| markdown render / feature | 766.81 ns avg |
| zod parse hot paths / SessionSchema.parse | 7.80 µs avg |
| zod parse hot paths / PlanSchema.parse | 6.83 µs avg |
| zod parse hot paths / WorkerResultSchema.parse | 813.25 ns avg |
| full saveSession cycle / 20-feature plan | 3.38 ms avg |
| warm saveSession cycle | 777.70 µs avg |

Warm `saveSession` baseline note: M5 is the first build with hash-based incremental markdown rendering, so the warm re-save row above is the initial recorded baseline for the unchanged-session path.
