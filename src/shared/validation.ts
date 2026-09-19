export const MAX_BYTES = 64_000;

export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function bounded(text: string, label: string): string {
	if (Buffer.byteLength(text) > MAX_BYTES)
		throw new Error(
			`${label} exceeds ${MAX_BYTES}-byte limit; narrow the selected scope.`,
		);
	return text;
}
