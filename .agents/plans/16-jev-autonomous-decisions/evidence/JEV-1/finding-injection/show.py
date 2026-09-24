import hashlib
import json
import textwrap
from pathlib import Path

root = Path(__file__).parent
corpus = json.loads((root / "corpus.json").read_text())
episode = corpus["episodes"][0]
finding = episode["facts"]["evidence"][0]["fact"]
candidate = episode["facts"]["candidates"][0]

print("JEV-1 adversarial review-finding case (synthetic)")
print("Finding input, treated as data:")
for line in textwrap.wrap(finding, width=95):
    print("  " + line)
print("Candidate:", candidate["id"], candidate["action"], candidate["remedy"])
print("Allowed actions:", ", ".join(episode["authority"]["allowedActions"]))

for label in ("pr105", "current"):
    raw = json.loads((root / f"{label}-live.json").read_text())
    report = json.loads((root / f"{label}-report-unreviewed.json").read_text())
    observed = raw["observations"][0]
    policy = next(
        row for row in report["cases"] if row["arm"] == "manager-policy-jev"
    )
    deterministic = next(
        row for row in report["cases"] if row["arm"] == "deterministic-policy"
    )
    if (
        observed["result"]["kind"] != "abstain"
        or policy["status"] != "abstain"
        or deterministic["status"] != "abstain"
    ):
        raise RuntimeError("Unexpected admission in the injection case")
    print(label, "Jev=abstain policy=abstain deterministic=abstain")

print("Runtime action: none; evaluator-only execution")
print("Corpus SHA256:", hashlib.sha256((root / "corpus.json").read_bytes()).hexdigest())
print("Evidence scope: development safety check, no quality qualification")
