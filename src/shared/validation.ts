export const MAX_BYTES = 64_000;
export const MAX_REVIEW_BYTES = 96_000;

export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function bounded(
	text: string,
	label: string,
	maxBytes = MAX_BYTES,
): string {
	if (Buffer.byteLength(text) > maxBytes)
		throw new Error(
			`${label} exceeds ${maxBytes}-byte limit; narrow the selected scope.`,
		);
	return text;
}
