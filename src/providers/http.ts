import { MAX_BYTES } from "../shared/validation.ts";
import {
	anthropicWire,
	openaiWire,
	parseAnthropic,
	parseOpenAI,
	type Wire,
} from "./llm.ts";
import { withinBudget } from "./request.ts";
import { parseResponse } from "./response.ts";
import {
	providers,
	type ReviewClient,
	type ReviewRequest,
	type ReviewResult,
} from "./types.ts";

const systemOne = (request: ReviewRequest, apiKey: string): Wire => ({
	headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
	body: { model: request.model, state: request.state, questions: request.questions },
});

// Wire format, parser, and timeout per provider; LLM reviews may think for minutes.
const adapters = {
	jev: { wire: systemOne, parse: parseResponse, timeout: 30_000 },
	laya: { wire: systemOne, parse: parseResponse, timeout: 30_000 },
	anthropic: { wire: anthropicWire, parse: parseAnthropic, timeout: 600_000 },
	openai: { wire: openaiWire, parse: parseOpenAI, timeout: 600_000 },
};

// Requests built before providers existed default to Jev.
function normalize(request: ReviewRequest): ReviewRequest {
	const provider = request.provider ?? "jev";
	return {
		...request,
		provider,
		endpoint: request.endpoint ?? providers[provider].endpoint,
	};
}

// The exact JSON body sent for a request; --dry-run prints it.
export function payload(request: ReviewRequest): unknown {
	const normalized = normalize(request);
	return adapters[normalized.provider].wire(normalized, "").body;
}

async function readJson(response: Response, label: string): Promise<unknown> {
	if (!response.body) throw new Error(`Missing ${label} response body.`);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		let chunk: ReadableStreamReadResult<Uint8Array>;
		try {
			chunk = await reader.read();
		} catch {
			throw new Error(`${label} network request failed or timed out; review unavailable.`);
		}
		if (chunk.done) break;
		size += chunk.value.byteLength;
		if (size > MAX_BYTES) {
			await reader.cancel().catch(() => {});
			throw new Error(`Invalid ${label} response: size limit exceeded.`);
		}
		chunks.push(chunk.value);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error(`Malformed ${label} JSON response.`);
	}
}

export async function review(
	request: ReviewRequest,
	apiKey: string,
): Promise<ReviewResult> {
	const normalized = withinBudget(normalize(request));
	const { provider, endpoint } = normalized;
	const { label, key } = providers[provider];
	// Self-hosted Laya and OpenAI-compatible servers on loopback may run without a key.
	const keyless =
		(provider === "laya" || provider === "openai") &&
		["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname);
	if (!apiKey.trim() && !keyless)
		throw new Error(`${key} is not set; review unavailable.`);
	const { wire, parse, timeout } = adapters[provider];
	const { headers, body } = wire(normalized, apiKey.trim());
	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(timeout),
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch {
		throw new Error(`${label} network request failed or timed out; review unavailable.`);
	}
	if (!response.ok)
		throw new Error(
			`${label} request failed (HTTP ${response.status}); review unavailable.`,
		);
	return parse(await readJson(response, label), normalized);
}

export const httpReview: ReviewClient = { review };
