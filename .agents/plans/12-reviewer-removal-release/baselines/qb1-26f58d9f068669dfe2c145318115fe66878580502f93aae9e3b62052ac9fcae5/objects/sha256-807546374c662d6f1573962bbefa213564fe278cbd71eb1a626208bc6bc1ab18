export type DeepReadonly<T> = T extends readonly (infer Item)[]
	? readonly DeepReadonly<Item>[]
	: T extends object
		? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
		: T;

export function freezeTree(value: unknown): void {
	if (value === null || typeof value !== "object" || Object.isFrozen(value))
		return;
	for (const child of Object.values(value)) freezeTree(child);
	Object.freeze(value);
}
