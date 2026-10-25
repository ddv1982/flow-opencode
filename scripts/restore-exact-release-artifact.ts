import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	exactPackageVersion,
	unpackedManifestSha256,
} from "../evals/provenance.js";
import { readQualificationBundle } from "../evals/qualification-bundle.js";

let [rebuiltPath, sealedPath, expectedSha256, version, ...extra] =
	process.argv.slice(2);
if (sealedPath === "--bundle") {
	if (!expectedSha256 || !version || extra.length)
		throw new Error(
			"Expected rebuilt tarball, --bundle, bundle directory, and version.",
		);
	const directory = expectedSha256;
	const bundle = await readQualificationBundle(directory);
	if (
		bundle.manifest.packageVersion !== exactPackageVersion(version) ||
		bundle.manifest.verdict !== "VERIFIED"
	)
		throw new Error(
			"Sealed qualification does not verify the requested version.",
		);
	const artifacts = bundle.files.filter((file) => file.ref.role === "artifact");
	const artifact = artifacts[0];
	if (artifacts.length !== 1 || !artifact)
		throw new Error("Sealed qualification requires exactly one artifact.");
	sealedPath = join(directory, artifact.ref.object);
	expectedSha256 = artifact.ref.sha256;
} else if (version || extra.length) {
	throw new Error(
		"Expected rebuilt tarball, sealed bundle object, and SHA-256.",
	);
}
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
