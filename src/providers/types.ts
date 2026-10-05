import type { State } from "../git/git.ts";

export const criteria = {
	supported:
		"The provided source directly supports the assertion within the selected scope.",
	contradicted:
		"The provided source contains a concrete counterexample to the assertion.",
	insufficient:
		"The provided evidence does not establish either outcome. Necessary context is missing or ambiguous.",
};

export type Choice = keyof typeof criteria;

// Endpoint, default model, and key variable per provider. Only Laya and
// OpenAI-compatible endpoints may be overridden, for self-hosted servers.
export const providers = {
	jev: {
		label: "Jev",
		endpoint: "https://api.typesafe.ai/v1/systemone",
		model: "jev-1.13.0",
		key: "TYPESAFE_API_KEY",
		models: /^jev-[a-z0-9.-]+$/,
	},
	laya: {
		label: "Laya",
		endpoint: "https://api.laya.studio/v1/systemone",
		model: "typed-decisions",
		key: "LAYA_API_KEY",
		models: /^[a-z0-9][a-z0-9._/-]{0,63}$/,
	},
	anthropic: {
		label: "Claude",
		endpoint: "https://api.anthropic.com/v1/messages",
		model: "claude-opus-5-5",
		key: "ANTHROPIC_API_KEY",
		models: /^claude-[a-z0-9.-]+$/,
	},
	openai: {
		label: "OpenAI-compatible",
		endpoint: "https://api.openai.com/v1/chat/completions",
		model: undefined,
		key: "OPENAI_API_KEY",
		models: /^[A-Za-z0-9._:/@-]{1,128}$/,
	},
} as const;

export type Provider = keyof typeof providers;

export type Finding = {
	id: string;
	choice: Choice;
	verdict: "supported" | "contradicted" | "needs_review";
	confidence: number;
	probabilities: Record<Choice, number>;
	rationale?: string;
};

export type ReviewRequest = {
	provider: Provider;
	endpoint: string;
	model: string;
	state: State;
	questions: Record<
		string,
		{
			type: "choice";
			instructions: string;
			criteria: typeof criteria;
		}
	>;
};

// calibrated: false marks model-reported (LLM) or uncalibrated (Laya) probabilities.
export type ReviewResult = {
	model: string;
	findings: Finding[];
	calibrated?: boolean;
};

export type ReviewClient = {
	review(request: ReviewRequest, apiKey: string): Promise<ReviewResult>;
};
