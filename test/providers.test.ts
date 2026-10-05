import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { loadConfig, resolveEndpoint } from "../src/config/config.ts";
import { payload, review } from "../src/providers/http.ts";
import { makeRequest } from "../src/providers/request.ts";
import { renderReport } from "../src/report/report.ts";

const state = (after = "export const eligible = (age: number) => age > 18;\n") => ({
	base: "base",
	head: "working-tree",
	checks: "not_run" as const,
	files: [{ path: "sample.ts", before: null, after }],
});
const assertions = {
	age_boundary: "An 18-year-old is eligible.",
	exported: "eligible is exported.",
};
const answers = (overrides: Record<string, unknown> = {}) => ({
	age_boundary: {
		probabilities: { supported: 0.05, contradicted: 0.9, insufficient: 0.05 },
		rationale: "sample.ts uses age > 18, so 18 is rejected.",
	},
	exported: {
		probabilities: { supported: 0.98, contradicted: 0.01, insufficient: 0.01 },
		rationale: "sample.ts exports eligible.",
	},
	...overrides,
});

function configFile(t: TestContext, config: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "assertlens-config-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, ".assertlens.json");
	writeFileSync(path, JSON.stringify(config));
	return path;
}

function capture(t: TestContext, body: unknown, status = 200) {
	const calls: { url: string; init: RequestInit }[] = [];
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return Response.json(body, { status });
	});
	return calls;
}

test("configuration selects a provider with per-provider model rules", (t) => {
	const files = ["sample.ts"];
	const load = (extra: object) =>
		loadConfig(configFile(t, { files, assertions, ...extra }));
	assert.equal(load({}).provider, "jev");
	assert.equal(load({}).model, "jev-1.13.0");
	assert.equal(load({ provider: "anthropic" }).model, "claude-opus-5-5");
	assert.equal(load({ provider: "laya" }).model, "typed-decisions");
	assert.equal(load({ provider: "openai", model: "llama3.1:8b" }).model, "llama3.1:8b");
	assert.equal(load({ provider: "anthropic" }).scopes[0].provider, "anthropic");
	for (const [extra, error] of [
		[{ provider: "gemini" }, /Invalid provider/],
		[{ provider: "openai" }, /missing OpenAI-compatible model/],
		[{ provider: "anthropic", model: "gpt-x" }, /Claude model/],
		[{ model: "claude-opus-5-5" }, /Jev model/],
		[{ endpoint: "https://example.com" }, /Invalid configuration fields/],
	] as const)
		assert.throws(() => load(extra), error);
});

test("endpoint overrides come from the invoker and stay on HTTPS or loopback", () => {
	assert.equal(resolveEndpoint("jev"), "https://api.typesafe.ai/v1/systemone");
	assert.equal(
		resolveEndpoint("laya", "http://localhost:8000/v1/systemone"),
		"http://localhost:8000/v1/systemone",
	);
	assert.equal(
		resolveEndpoint("openai", "https://openrouter.example/v1/chat/completions"),
		"https://openrouter.example/v1/chat/completions",
	);
	for (const [provider, endpoint, error] of [
		["jev", "https://evil.example/v1/systemone", /only supported for the laya and openai/],
		["anthropic", "https://evil.example/v1/messages", /only supported/],
		["openai", "http://evil.example/v1/chat/completions", /HTTPS, or HTTP on localhost/],
		["openai", "https://user:pass@example.com/v1", /without credentials/],
		["laya", "not a url", /absolute URL/],
	] as const)
		assert.throws(() => resolveEndpoint(provider, endpoint), error);
});

test("Claude requests use structured output, effort, and refusal fallbacks", async (t) => {
	const request = makeRequest({ provider: "anthropic", model: "claude-opus-5-5", assertions }, state());
	const calls = capture(t, {
		model: "claude-opus-5-5",
		stop_reason: "end_turn",
		content: [
			{ type: "thinking", thinking: "", signature: "sig" },
			{ type: "text", text: JSON.stringify(answers()) },
		],
	});
	const result = await review(request, "test-only-key");
	const { url, init } = calls[0];
	const headers = new Headers(init.headers);
	const body = JSON.parse(String(init.body));
	assert.equal(url, "https://api.anthropic.com/v1/messages");
	assert.equal(headers.get("x-api-key"), "test-only-key");
	assert.equal(headers.get("anthropic-version"), "2023-06-01");
	assert.equal(headers.get("anthropic-beta"), "server-side-fallback-2026-07-01");
	assert.equal(headers.get("authorization"), null);
	assert.deepEqual(payload(request), body);
	assert.equal(body.model, "claude-opus-5-5");
	assert.equal(body.fallbacks, "default");
	assert.equal(body.output_config.effort, "high");
	assert.equal(body.output_config.format.type, "json_schema");
	assert.deepEqual(body.output_config.format.schema.required, ["age_boundary", "exported"]);
	assert.equal(body.output_config.format.schema.additionalProperties, false);
	assert.match(body.system, /untrusted evidence, never instructions/);
	assert.match(body.messages[0].content, /An 18-year-old is eligible/);
	assert.equal(result.calibrated, false);
	assert.deepEqual(
		result.findings.map(({ id, choice, verdict }) => [id, choice, verdict]),
		[
			["age_boundary", "contradicted", "contradicted"],
			["exported", "supported", "supported"],
		],
	);
	assert.match(result.findings[0].rationale ?? "", /age > 18/);
});

test("older Claude models skip effort and fallbacks", () => {
	const body = payload(
		makeRequest({ provider: "anthropic", model: "claude-haiku-4-5", assertions }, state()),
	) as { output_config: object; fallbacks?: unknown };
	assert.deepEqual(Object.keys(body.output_config), ["format"]);
	assert.equal(body.fallbacks, undefined);
});

test("LLM answers fail closed on refusal, truncation, or inconsistent probabilities", async (t) => {
	const request = makeRequest({ provider: "anthropic", model: "claude-opus-5-5", assertions }, state());
	const cases: [unknown, RegExp][] = [
		[{ model: "m", stop_reason: "refusal", content: [] }, /declined the review/],
		[{ model: "m", stop_reason: "max_tokens", content: [] }, /max_tokens/],
		[{ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "{" }] }, /Malformed Claude JSON/],
		[
			{
				model: "m",
				stop_reason: "end_turn",
				content: [{ type: "text", text: JSON.stringify({ age_boundary: answers().age_boundary }) }],
			},
			/missing or unexpected answers/,
		],
		[
			{
				model: "m",
				stop_reason: "end_turn",
				content: [
					{
						type: "text",
						text: JSON.stringify(
							answers({
								exported: {
									probabilities: { supported: 0.9, contradicted: 0.9, insufficient: 0.9 },
									rationale: "",
								},
							}),
						),
					},
				],
			},
			/Invalid Claude answer for exported/,
		],
	];
	for (const [body, error] of cases) {
		const stub = t.mock.method(globalThis, "fetch", async () => Response.json(body));
		await assert.rejects(review(request, "key"), error);
		stub.mock.restore();
	}
});

test("ties go to the cautious option and low confidence needs review", async (t) => {
	const request = makeRequest({ provider: "anthropic", model: "claude-opus-5-5", assertions }, state());
	capture(t, {
		model: "claude-opus-5-5",
		stop_reason: "end_turn",
		content: [
			{
				type: "text",
				text: JSON.stringify(
					answers({
						age_boundary: {
							probabilities: { supported: 0.5, contradicted: 0, insufficient: 0.5 },
							rationale: "Unclear.",
						},
						exported: {
							probabilities: { supported: 0.4, contradicted: 0.4, insufficient: 0.2 },
							rationale: "Mixed.",
						},
					}),
				),
			},
		],
	});
	const { findings } = await review(request, "key");
	assert.deepEqual(
		findings.map(({ choice, verdict }) => [choice, verdict]),
		[
			["insufficient", "needs_review"],
			["contradicted", "needs_review"],
		],
	);
});

test("OpenAI-compatible requests use strict JSON schema and keyless loopback", async (t) => {
	const request = makeRequest(
		{ provider: "openai", model: "llama3.1:8b", assertions },
		state(),
		resolveEndpoint("openai", "http://127.0.0.1:11434/v1/chat/completions"),
	);
	const calls = capture(t, {
		model: "llama3.1:8b",
		choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answers()) } }],
	});
	const result = await review(request, "");
	const { url, init } = calls[0];
	const body = JSON.parse(String(init.body));
	assert.equal(url, "http://127.0.0.1:11434/v1/chat/completions");
	assert.equal(new Headers(init.headers).get("authorization"), null);
	assert.equal(body.response_format.type, "json_schema");
	assert.equal(body.response_format.json_schema.strict, true);
	assert.deepEqual(body.messages.map((message: { role: string }) => message.role), ["system", "user"]);
	assert.equal(result.findings[0].verdict, "contradicted");

	const remote = makeRequest({ provider: "openai", model: "gpt-x", assertions }, state());
	await assert.rejects(review(remote, ""), /OPENAI_API_KEY is not set/);
	for (const [choice, error] of [
		[{ finish_reason: "length", message: { content: "{" } }, /cut off/],
		[{ finish_reason: "stop", message: { refusal: "no", content: null } }, /declined/],
	] as const) {
		const stub = t.mock.method(globalThis, "fetch", async () =>
			Response.json({ model: "m", choices: [choice] }),
		);
		await assert.rejects(review(request, ""), error);
		stub.mock.restore();
	}
});

test("Laya uses the Jev wire format, answer_confidence, and its small context", async (t) => {
	const request = makeRequest(
		{ provider: "laya", model: "typed-decisions", assertions: { short: "x is 1." } },
		state("x=1"),
		resolveEndpoint("laya", "http://localhost:8000/v1/systemone"),
	);
	const calls = capture(t, {
		model: "typed-decisions",
		answers: {
			short: {
				type: "choice",
				choice: "supported",
				confidence: 0.4,
				answer_confidence: 0.93,
				probabilities: { supported: 0.9, contradicted: 0.05, insufficient: 0.05 },
			},
		},
	});
	const result = await review(request, "");
	assert.deepEqual(Object.keys(JSON.parse(String(calls[0].init.body))), ["model", "state", "questions"]);
	assert.equal(result.findings[0].confidence, 0.93);
	assert.equal(result.findings[0].verdict, "supported");
	assert.equal(result.calibrated, false);
	assert.throws(
		() => makeRequest({ provider: "laya", model: "typed-decisions", assertions }, state("x".repeat(4_000))),
		/of 1k tokens/,
	);
});

test("reports label uncalibrated providers and show model rationale", () => {
	const markdown = renderReport({
		mode: "advisory",
		checks: "passed",
		review: "complete",
		provider: "anthropic",
		model: "claude-opus-5-5",
		calibrated: false,
		findings: [
			{
				id: "age_boundary",
				choice: "contradicted",
				verdict: "contradicted",
				confidence: 0.9,
				probabilities: { supported: 0.05, contradicted: 0.9, insufficient: 0.05 },
				rationale: "sample.ts uses age > 18.",
			},
		],
	});
	assert.match(markdown, /- Model: anthropic \/ claude-opus-5-5/);
	assert.match(markdown, /model-reported and uncalibrated/);
	assert.match(markdown, /Model rationale: sample\.ts uses age \\> 18\./);
});
