# Qualification records

One JSON file per major release, written by `bun run qualify -- --record <version>`
when a report clears every published threshold and its `flowVersion` matches
this repository. `scripts/release-metadata.ts`
refuses an `x.0.0` tag whose record is missing, mismatched, or not `QUALIFIED`.

This is a checklist with a filename, not a forged-proof gate. A human can write
the file by hand. The point is that a major tag cannot be cut without one, so
skipping the qualification run has to show up in the release diff.
