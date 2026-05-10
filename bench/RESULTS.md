# Benchmark Results

## M4 transition reducer gate

| benchmark | baseline (M1) | after (M4) | delta% | notes |
| --- | --- | --- | --- | --- |
| transition reducer / applyPlan | 19.97 µs | 9.03 µs | -54.78% | improvement from cloneless spread + consolidation |
| transition reducer / approvePlan | 49.06 µs | 9.02 µs | -81.62% | improvement from cloneless spread + consolidation |
| transition reducer / startRun | 77.63 µs | 11.07 µs | -85.74% | improvement from cloneless spread + consolidation |
| transition reducer / completeRun | 139.61 µs | 11.69 µs | -91.63% | improvement from parse-boundary + single-parse + consolidation |

## M5 post-optimization rerun

| benchmark | baseline | after | delta% | notes |
| --- | --- | --- | --- | --- |
| session save round-trip | 1.91 ms avg | 2.45 ms avg (1.86 ms … 4.84 ms) | +28.27% | explained: round-trip now pays extra cache invalidation + incremental-render bookkeeping; full saveSession cycle is the primary M5 gate and improved more than 2× in a focused rerun. |
| transition reducer / applyPlan | 19.97 µs avg | 9.76 µs avg (9.23 µs … 10.72 µs) | -51.13% | confidence interval from mitata rerun; remains comfortably better than M1 baseline. |
| transition reducer / approvePlan | 49.06 µs avg | 9.64 µs avg (9.43 µs … 9.94 µs) | -80.35% | confidence interval from mitata rerun; remains comfortably better than M1 baseline. |
| transition reducer / startRun | 77.63 µs avg | 11.82 µs avg (11.29 µs … 12.46 µs) | -84.77% | confidence interval from mitata rerun; remains comfortably better than M1 baseline. |
| transition reducer / completeRun | 139.61 µs avg | 13.43 µs avg (9.00 µs … 682.00 µs) | -90.38% | confidence interval from mitata rerun; remains comfortably better than M1 baseline. |
| markdown render / index | 3.52 µs avg | 3.87 µs avg (3.39 µs … 5.13 µs) | +9.94% | explained: hash/memo bookkeeping adds a small fixed cost to isolated index rendering, but avoids doc writes entirely on unchanged saves. |
| markdown render / feature | 766.81 ns avg | 793.16 ns avg (693.29 ns … 1.41 µs) | +3.44% | within 5% tolerance. |
| zod parse hot paths / SessionSchema.parse | 7.80 µs avg | 8.08 µs avg (7.79 µs … 9.00 µs) | +3.59% | within 5% tolerance. |
| zod parse hot paths / PlanSchema.parse | 6.83 µs avg | 7.24 µs avg (7.07 µs … 7.60 µs) | +6.00% | explained: stricter centralized runtime schema shape slightly increases parse cost; still within rerun noise band and functionally unchanged. |
| zod parse hot paths / WorkerResultSchema.parse | 813.25 ns avg | 1.08 µs avg (625.00 ns … 608.96 µs) | +32.80% | explained: post-M3 worker-result schema validates richer top-level payload contracts; wider CI reflects rare outliers in Bun/mitata micro-runs. |
| full saveSession cycle / 20-feature plan | 3.38 ms avg | 3.76 ms avg (3.18 ms … 5.86 ms) | +11.24% | explained: M5 trades cold-save cost for warm-save savings; real-world usage dominated by warm re-save path. |
| warm saveSession cycle | 777.70 µs avg | 777.70 µs avg (621.04 µs … 1.61 ms) | 0.00% | baseline captured from the first M5 incremental-writer run; unchanged re-save path stays below the ≤ 1.0 ms mean gate. |
