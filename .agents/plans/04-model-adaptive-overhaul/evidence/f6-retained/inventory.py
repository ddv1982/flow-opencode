"""Read retained release transcripts; print an inventory without running models.

Usage: python3 inventory.py PATH_TO_CAMPAIGN > inventory.json
No human labels, grading decisions, or qualification records are produced.
"""

import collections
import hashlib
import json
import pathlib
import sys

campaign = pathlib.Path(sys.argv[1])
rows = []
counts = collections.Counter()
for path in sorted((campaign / "transcripts").glob("*.json")):
    data = json.loads(path.read_bytes())
    attempt = data["attempt"]
    grade = data["gradeInput"]
    documents = grade["archives"] + ([grade["session"]] if grade["session"] else [])
    reviews = []
    seen = set()
    for document in documents:
        for run in document.get("runs", []):
            for review in run.get("reviews", []):
                assert review["id"] not in seen, "duplicate assignment"
                seen.add(review["id"])
                reviews.append({
                    "assignmentId": review["id"],
                    "sourceDigest": review["sourceDigest"],
                    "result": review["result"],
                })
    counts["attempts"] += 1
    counts["attemptsWithReviews"] += bool(reviews)
    for review in reviews:
        counts[review["result"]["verdict"]] += 1
    row = {
        "caseId": attempt["caseId"],
        "model": attempt["model"]["routeProvider"] + "/" + attempt["model"]["model"],
        "repetition": attempt["repetition"],
        "attemptId": attempt["attemptId"],
        "transcript": str(path.relative_to(campaign)),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sampled": attempt["repetition"] == 1,
        "reviews": reviews,
    }
    if row["sampled"]:
        row["reviewerObservations"] = [
            actor.get("hostObservation") for actor in data["actors"]
            if actor["role"] == "reviewer"
        ]
        row["reviewCalls"] = [
            {"index": i, "tool": call["tool"], "input": call["input"]}
            for i, call in enumerate(grade["allCalls"])
            if call["tool"] in ("flow_review_start", "flow_feature_complete")
        ]
    rows.append(row)

assert len({row["attemptId"] for row in rows}) == len(rows)
assert rows, "no transcripts found"
rows.sort(key=lambda row: (row["caseId"], row["model"], row["repetition"]))
print(json.dumps({
    "schemaVersion": 1,
    "purpose": "Descriptive retained-evidence audit; not human calibration",
    "campaign": campaign.name,
    "sampleRule": "repetition == 1 for every case/model cell",
    "counts": dict(sorted(counts.items())),
    "attempts": rows,
}, indent=2) + "")
