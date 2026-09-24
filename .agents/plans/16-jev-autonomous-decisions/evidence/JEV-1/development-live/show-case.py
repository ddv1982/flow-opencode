import hashlib
import json
import sys
from pathlib import Path

case = sys.argv[1] if len(sys.argv) == 2 else None
labels = {
    "new-scope": "repair changes the approved outcome",
    "mixed-scope": "repair bundles an unrelated outcome",
    "injection": "finding text attempts to override policy",
    "no-fit": "three remedies do not fit the blocker",
}
if case not in labels:
    raise SystemExit("Expected new-scope, mixed-scope, injection, or no-fit")

root = Path(__file__).parent
collector = root / "collector.json"
report_path = root / "report-unreviewed.json"
raw = json.loads(collector.read_text())
report = json.loads(report_path.read_text())
corpus = json.loads(
    (Path(__file__).resolve().parents[6] / "evals/blocker-decisions/v1.json").read_text()
)
episode = next(row for row in corpus["episodes"] if row["id"] == case)
observation = next(
    row for row in raw["observations"] if row["episodeId"] == case
)
evaluation = next(
    row
    for row in report["cases"]
    if row["episodeId"] == case and row["arm"] == "manager-policy-jev"
)
deterministic = next(
    row
    for row in report["cases"]
    if row["episodeId"] == case and row["arm"] == "deterministic-policy"
)

print("JEV-1 frozen development case:", case)
print("Code head: 5db4e9852492cf671f16534be52a23e00fb655a4")
print("Scenario:", labels[case])
print(
    "Candidate actions:",
    ", ".join(f"{row['id']}:{row['action']}" for row in episode["facts"]["candidates"]),
)
print(
    "Changes approved goal:",
    ", ".join(
        f"{row['id']}={row['changesGoal']}" for row in episode["facts"]["candidates"]
    ),
)
print("Deterministic policy:", deterministic["status"])
print(
    "Live Jev choice:",
    observation["result"]["kind"],
    observation["result"].get("candidateId", "none"),
)
print(
    "Requested/resolved:",
    observation["metrics"]["requestedModel"],
    observation["metrics"]["resolvedModel"],
)
print("Policy replay:", evaluation["status"])
print("Forbidden proposal:", evaluation["forbiddenProposal"])
print("Runtime action: none; this is an evaluator-only case")
print("Report verdict:", report["verdict"], "(reloaded evidence is unreviewed)")
print("Collector SHA256:", hashlib.sha256(collector.read_bytes()).hexdigest())
print("Report SHA256:   ", hashlib.sha256(report_path.read_bytes()).hexdigest())
