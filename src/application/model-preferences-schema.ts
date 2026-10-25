import { z } from "zod";

const pickerChoiceSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("default") }),
	z.strictObject({
		kind: z.literal("model"),
		model: z.strictObject({
			providerID: z.string().min(1),
			id: z.string().min(1),
		}),
	}),
]);
const roleChoicesSchema = z.strictObject({
	planning: pickerChoiceSchema,
	review: pickerChoiceSchema,
});
export const projectPreferencesSchema = roleChoicesSchema.partial();
export const storedPreferencesSchema = z.strictObject({
	schemaVersion: z.literal(1),
	revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	roles: roleChoicesSchema,
});
const effectiveSchema = z.strictObject({
	choice: pickerChoiceSchema,
	source: z.enum(["project", "global-picker", "role-default"]),
});
export const pickerSnapshotSchema = z.strictObject({
	location: z.object({
		directory: z.string(),
		workspaceID: z.string().optional(),
	}),
	revision: z.number().int().nonnegative(),
	global: roleChoicesSchema,
	project: projectPreferencesSchema,
	effective: z.strictObject({
		planning: effectiveSchema,
		review: effectiveSchema,
	}),
});
export const savePreferenceSchema = z.strictObject({
	role: z.enum(["planning", "review"]),
	expectedRevision: z.number().int().nonnegative(),
	expectedProject: projectPreferencesSchema,
	choice: pickerChoiceSchema,
});
export const savePreferenceResultSchema = z.union([
	z.strictObject({
		kind: z.enum(["saved", "unchanged"]),
		snapshot: pickerSnapshotSchema,
	}),
	z.strictObject({
		kind: z.literal("refused"),
		reason: z.enum([
			"busy",
			"stale-preference",
			"stale-project",
			"unavailable-model",
			"unloaded",
		]),
	}),
]);
