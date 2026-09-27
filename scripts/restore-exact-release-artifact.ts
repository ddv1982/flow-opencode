import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { unpackedManifestSha256 } from "../evals/provenance.js";

const [rebuiltPath, sealedPath, expectedSha256] = process.argv.slice(2);
if (
	!rebuiltPath ||
	!sealedPath ||
	!/^sha256:[a-f0-9]{64}$/.test(expectedSha256 ?? "")
)
	throw new Error(
		"Expected rebuilt tarball, sealed bundle object, and SHA-256.",
	);

const sealedBytes = await readFile(sealedPath);
const actualSha256 = `sha256:${createHash("sha256").update(sealedBytes).digest("hex")}`;
if (actualSha256 !== expectedSha256)
	throw new Error("Sealed release artifact has the wrong digest.");

const [rebuiltManifest, sealedManifest] = await Promise.all([
	unpackedManifestSha256(rebuiltPath),
	unpackedManifestSha256(sealedPath),
]);
if (rebuiltManifest !== sealedManifest)
	throw new Error(
		"Rebuilt package contents differ from the qualified artifact.",
	);

await writeFile(rebuiltPath, sealedBytes);
console.log(`Restored exact release artifact ${actualSha256}.`);
