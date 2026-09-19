import { bounded, MAX_BYTES } from "../shared/validation.ts";
import type {
	ReviewClient,
	ReviewRequest,
	ReviewResult,
} from "./jev.ts";
import { parseResponse } from "./response.ts";

export async function review(
	request: ReviewRequest,
	apiKey: string,
): Promise<ReviewResult> {
	if (!apiKey.trim())
		throw new Error("TYPESAFE_API_KEY is not set; review unavailable.");
	let raw: unknown;
	try {
		const response = await fetch("https://api.typesafe.ai/v1/systemone", {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: bounded(JSON.stringify(request), "Request"),
		});
		if (!response.ok)
			throw new Error(
				`Jev request failed (HTTP ${response.status}); review unavailable.`,
			);
		if (!response.body) throw new Error("Missing Jev response body.");
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BYTES) {
				await reader.cancel();
				throw new Error("Invalid Jev response: size limit exceeded.");
			}
			chunks.push(value);
		}
		try {
			raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			throw new Error("Malformed Jev JSON response.");
		}
	} catch (error) {
		if (
			error instanceof Error &&
			/^(Jev request failed|Missing Jev|Invalid Jev|Malformed Jev)/.test(
				error.message,
			)
		)
			throw error;
		throw new Error(
			"Jev network request failed or timed out; review unavailable.",
		);
	}
	return parseResponse(raw, request);
}

export const httpJev: ReviewClient = { review };
