import hashlib
import json
from pathlib import Path

path = Path(__file__).parent / "fault-results.json"
data = json.loads(path.read_text())
print("JEV-1 provider faults at final-stack code head")
print("Code head: 7a1cb596a3a231d8951a8842e43cec6ef70f5c31")
print("Injected transport, zero provider calls")
for row in data["cases"]:
    print(
        row["case"],
        "injected=", row.get("injectedHttpStatus", "no response"),
        "attempts=", row["dispatches"],
        "reason=", row["result"]["reason"],
        "elapsed_ms=", round(row["elapsedMs"], 1),
    )
print("Artifact SHA256:", hashlib.sha256(path.read_bytes()).hexdigest())
print("Evidence scope: bounded faults, no Jev quality claim")
