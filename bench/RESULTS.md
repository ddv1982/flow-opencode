# Benchmark Results

## M4 transition reducer gate

| benchmark | baseline (M1) | after (M4) | delta% | notes |
| --- | --- | --- | --- | --- |
| transition reducer / applyPlan | 19.97 µs | 9.03 µs | -54.78% | improvement from cloneless spread + consolidation |
| transition reducer / approvePlan | 49.06 µs | 9.02 µs | -81.62% | improvement from cloneless spread + consolidation |
| transition reducer / startRun | 77.63 µs | 11.07 µs | -85.74% | improvement from cloneless spread + consolidation |
| transition reducer / completeRun | 139.61 µs | 11.69 µs | -91.63% | improvement from parse-boundary + single-parse + consolidation |
