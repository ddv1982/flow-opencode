import hashlib
import json
from pathlib import Path

path = Path(__file__).parent / "collector.json"
data = json.loads(path.read_text())
observations = data["observations"]
first = observations[0]
metrics = first["metrics"]
print("JEV-1 official provider at final-stack code head")
print("Code head: 7a1cb596a3a231d8951a8842e43cec6ef70f5c31")
print("Command: collect-jev --max-calls 24 --max-usd 0.10")
print("Live observations:", len(observations))
print("Requested/resolved:", metrics["requestedModel"], metrics["resolvedModel"])
print("All resolved IDs match:", all(x["metrics"]["resolvedModel"] == "jev-1.13.0" for x in observations))
print("Attempts:", sum(x["metrics"]["attempts"] for x in observations))
print("Reserved USD:", sum(x["metrics"]["reservedUsd"] for x in observations))
print("Collector SHA256:", hashlib.sha256(path.read_bytes()).hexdigest())
print("Evidence scope: synthetic availability only; no holdout quality claim")
