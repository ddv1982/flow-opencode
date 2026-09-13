import { createHmac } from "node:crypto";
import { readFileSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

const stringify = JSON.stringify.bind(JSON);
const emit = writeSync.bind(null, 1);
const create = Object.create.bind(Object);
const setPrototype = Object.setPrototypeOf.bind(Object);
const descriptors = Object.getOwnPropertyDescriptors.bind(Object);
const keys = Object.keys.bind(Object);
const prototypeOf = Object.getPrototypeOf.bind(Object);
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const isArray = Array.isArray.bind(Array);
const finite = Number.isFinite.bind(Number);
const own = Object.hasOwn.bind(Object);
const apply = Reflect.apply.bind(Reflect);
const request = JSON.parse(readFileSync(0, "utf8")) as {
	module: string;
	exportName: string;
	args: unknown[];
	authenticationKey: string;
};
const authentication = createHmac("sha256", request.authenticationKey);
const authenticate = authentication.update.bind(authentication);
const authenticationDigest = authentication.digest.bind(authentication);

function jsonData(value: unknown, depth = 0): unknown {
	if (depth > 64) throw new Error("Result nesting exceeds its limit.");
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number" && finite(value)) return value;
	if (typeof value !== "object") throw new Error("Result is not JSON data.");
	const properties = descriptors(value);
	const array = isArray(value);
	const prototype = prototypeOf(value);
	if (
		array
			? prototype !== arrayPrototype
			: prototype !== objectPrototype && prototype !== null
	)
		throw new Error("Result contains a non-JSON object.");
	const result: Record<string, unknown> = array
		? setPrototype([], null)
		: create(null);
	if (array) {
		const length = properties.length?.value;
		if (!finite(length) || length > 100_000)
			throw new Error("Result array exceeds its limit.");
		for (let index = 0; index < length; index += 1)
			if (!own(properties, index))
				throw new Error("Sparse arrays are not JSON data.");
	}
	const names = keys(properties);
	for (let index = 0; index < names.length; index += 1) {
		const key = names[index];
		if (key === undefined) throw new Error("Result property is unavailable.");
		const property = properties[key];
		if (!property) throw new Error("Result property is unavailable.");
		if (array && key === "length") continue;
		if (array && !/^(0|[1-9][0-9]*)$/.test(key))
			throw new Error("Array contains non-index properties.");
		if (
			!own(property, "value") ||
			typeof property.value === "undefined" ||
			typeof property.value === "function"
		)
			throw new Error("Result contains non-data properties.");
		result[key] = jsonData(property.value, depth + 1);
	}
	return result;
}

function finish(kind: string, value?: unknown): void {
	const observation = create(null);
	observation.kind = kind;
	if (kind === "returned") observation.value = jsonData(value);
	if (kind === "returned" || kind === "threw")
		observation.args = jsonData(request.args);
	if (kind === "execution-error") observation.detail = value;
	const message = stringify(observation);
	authenticate(message);
	const envelope = create(null);
	envelope.message = message;
	envelope.authentication = authenticationDigest("hex");
	emit(`\n${stringify(envelope)}\n`);
}

let loaded: Record<string, unknown>;
try {
	loaded = await import(pathToFileURL(request.module).href);
} catch {
	finish("execution-error", "Module import failed.");
	process.exit(0);
}
const callable = loaded[request.exportName];
if (typeof callable !== "function") {
	finish("execution-error", "Requested export is not a function.");
	process.exit(0);
}
let value: unknown;
try {
	value = await apply(callable, undefined, request.args);
} catch {
	finish("threw");
	process.exit(0);
}
try {
	finish("returned", value);
} catch {
	finish("execution-error", "Result is not bounded JSON data.");
}
