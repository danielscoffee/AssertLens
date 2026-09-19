import { object } from "../shared/validation.ts";
import {
	criteria,
	type Choice,
	type Finding,
	type ReviewRequest,
	type ReviewResult,
} from "./jev.ts";

const REVIEW_CONFIDENCE = 0.8; // Advisory starting point, not a calibrated correctness threshold.

export function parseResponse(
	raw: unknown,
	request: ReviewRequest,
): ReviewResult {
	if (
		!object(raw) ||
		typeof raw.model !== "string" ||
		!raw.model ||
		raw.model.length > 128 ||
		!object(raw.answers)
	) {
		throw new Error("Invalid Jev response: missing model or answers.");
	}
	const answers = raw.answers;
	const ids = Object.keys(request.questions);
	if (Object.keys(answers).length !== ids.length)
		throw new Error("Invalid Jev response: missing or unexpected answers.");
	const findings = ids.map((id): Finding => {
		const answer = answers[id];
		if (
			!object(answer) ||
			answer.type !== "choice" ||
			typeof answer.choice !== "string" ||
			!Object.hasOwn(criteria, answer.choice) ||
			typeof answer.confidence !== "number" ||
			!Number.isFinite(answer.confidence) ||
			answer.confidence < 0 ||
			answer.confidence > 1 ||
			!object(answer.probabilities)
		)
			throw new Error(`Invalid Jev answer for ${id}.`);
		const probabilities = answer.probabilities;
		const options = Object.keys(criteria);
		if (
			Object.keys(probabilities).length !== options.length ||
			options.some(
				(key) =>
					typeof probabilities[key] !== "number" ||
					!Number.isFinite(probabilities[key]) ||
					probabilities[key] < 0 ||
					probabilities[key] > 1,
			)
		)
			throw new Error(`Invalid Jev probabilities for ${id}.`);
		const distribution = probabilities as Record<Choice, number>;
		const choice = answer.choice as Choice;
		if (
			Math.abs(Object.values(distribution).reduce((sum, p) => sum + p, 0) - 1) >
				0.00001 ||
			distribution[choice] < Math.max(...Object.values(distribution)) - 0.00001
		) {
			throw new Error(`Invalid Jev probability distribution for ${id}.`);
		}
		return {
			id,
			choice,
			confidence: answer.confidence,
			probabilities: distribution,
			verdict:
				choice === "insufficient" || answer.confidence < REVIEW_CONFIDENCE
					? "needs_review"
					: choice,
		};
	});
	return { model: raw.model, findings };
}
