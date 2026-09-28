#!/usr/bin/env python3
import argparse
import hashlib
import json
import shutil
from pathlib import Path


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def encoded(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("target", type=Path)
parser.add_argument("--home-prefix", required=True)
parser.add_argument("--artifact-sha256", required=True)
args = parser.parse_args()

if args.target.exists():
    raise SystemExit("Target already exists")
if sha256((args.source / "artifact.tgz").read_bytes()) != args.artifact_sha256:
    raise SystemExit("Campaign artifact differs from the declared release artifact")

shutil.copytree(args.source, args.target)
report_path = args.target / "report.json"
original_report = (args.source / "report.json").read_bytes()
report = json.loads(original_report)
receipts = []
allowed = (
    args.home_prefix + "/.bun/bin/bun\n",
    args.home_prefix + "/.bun/bin/bun\n/usr/bin/wine\n",
)

for attempt in report["attempts"]:
    transcript_path = args.target / attempt["transcript"]["artifact"]
    original = transcript_path.read_bytes()
    if args.home_prefix.encode() not in original:
        continue
    transcript = json.loads(original)
    changed = []
    for index, call in enumerate(transcript["gradeInput"]["allCalls"]):
        if args.home_prefix in json.dumps(call):
            command = call.get("input", {}).get("command")
            if (
                call.get("tool") != "bash"
                or not isinstance(command, str)
                or not command.startswith("command -v bun")
            ):
                raise SystemExit("Home path came from an unexpected tool call")
        for field in ("output", "rawOutput"):
            value = call.get(field)
            if isinstance(value, str) and args.home_prefix in value:
                if value not in allowed:
                    raise SystemExit("Unexpected home path in retained call output")
                call[field] = value.replace(args.home_prefix, "<redacted-home>")
                changed.append(f"/gradeInput/allCalls/{index}/{field}")
        metadata = call.get("metadata")
        if isinstance(metadata, dict):
            value = metadata.get("output")
            if isinstance(value, str) and args.home_prefix in value:
                if value not in allowed:
                    raise SystemExit("Unexpected home path in retained call metadata")
                metadata["output"] = value.replace(args.home_prefix, "<redacted-home>")
                changed.append(f"/gradeInput/allCalls/{index}/metadata/output")
    if len(changed) != 3:
        raise SystemExit("Each affected transcript must have exactly three redacted fields")

    redacted = encoded(transcript)
    if args.home_prefix.encode() in redacted:
        raise SystemExit("Retained transcript still contains the home path")
    transcript_path.write_bytes(redacted)
    old_sha = sha256(original)
    new_sha = sha256(redacted)
    if attempt["transcript"]["sha256"] != old_sha:
        raise SystemExit("Report transcript binding differs from source bytes")
    attempt["transcript"]["sha256"] = new_sha

    matches = 0
    for path in (args.target / "attempts").glob("*.json"):
        retained = json.loads(path.read_bytes())
        if retained["attemptId"] != attempt["attemptId"]:
            continue
        if retained["transcript"]["sha256"] != old_sha:
            raise SystemExit("Attempt transcript binding differs from source bytes")
        retained["transcript"]["sha256"] = new_sha
        path.write_bytes(encoded(retained))
        matches += 1
    if matches != 1:
        raise SystemExit("Expected exactly one retained attempt for the transcript")

    receipts.append(
        {
            "attemptId": attempt["attemptId"],
            "transcript": attempt["transcript"]["artifact"],
            "oldSha256": old_sha,
            "newSha256": new_sha,
            "fields": changed,
            "reason": "Redact the local Bun executable home path; leave model decisions and Flow state unchanged.",
        }
    )

if len(receipts) != 2:
    raise SystemExit("Expected exactly two affected transcripts")
report_path.write_bytes(encoded(report))
receipt = {
    "schemaVersion": 1,
    "artifactSha256": args.artifact_sha256,
    "sourceReportSha256": sha256(original_report),
    "derivedReportSha256": sha256(report_path.read_bytes()),
    "changes": receipts,
}
(args.target.parent / "campaign-redaction-receipt.json").write_bytes(
    encoded(receipt)
)
print("Redacted two transcripts and six tool-output fields.")
