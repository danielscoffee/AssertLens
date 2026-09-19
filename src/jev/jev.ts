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

export type Finding = {
	id: string;
	choice: Choice;
	verdict: "supported" | "contradicted" | "needs_review";
	confidence: number;
	probabilities: Record<Choice, number>;
};

export type ReviewRequest = {
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

export type ReviewResult = { model: string; findings: Finding[] };

export type ReviewClient = {
	review(request: ReviewRequest, apiKey: string): Promise<ReviewResult>;
};
