import { object } from "../shared/validation.ts";
import {
	criteria,
	providers,
	type Choice,
	type Finding,
	type ReviewRequest,
	type ReviewResult,
} from "./types.ts";

export const REVIEW_CONFIDENCE = 0.8; // Advisory starting point, not a calibrated correctness threshold.

// Insufficient evidence or low confidence always asks for human review.
export function finding(
	id: string,
	choice: Choice,
	confidence: number,
	probabilities: Record<Choice, number>,
	rationale?: string,
): Finding {
	return {
		id,
		choice,
		confidence,
		probabilities,
		verdict:
			choice === "insufficient" || confidence < REVIEW_CONFIDENCE
				? "needs_review"
				: choice,
		...(rationale ? { rationale } : {}),
	};
}

// Jev and Laya share the /v1/systemone answer format.

export function parseResponse(
	raw: unknown,
	request: ReviewRequest,
): ReviewResult {
	const label = providers[request.provider ?? "jev"].label;
	if (
		!object(raw) ||
		typeof raw.model !== "string" ||
		!raw.model ||
		raw.model.length > 128 ||
		!object(raw.answers)
	) {
		throw new Error(`Invalid ${label} response: missing model or answers.`);
	}
	const answers = raw.answers;
	const ids = Object.keys(request.questions);
	if (Object.keys(answers).length !== ids.length)
		throw new Error(`Invalid ${label} response: missing or unexpected answers.`);
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
			throw new Error(`Invalid ${label} answer for ${id}.`);
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
			throw new Error(`Invalid ${label} probabilities for ${id}.`);
		const distribution = probabilities as Record<Choice, number>;
		const choice = answer.choice as Choice;
		if (
			Math.abs(Object.values(distribution).reduce((sum, p) => sum + p, 0) - 1) >
				0.00001 ||
			distribution[choice] < Math.max(...Object.values(distribution)) - 0.00001
		) {
			throw new Error(`Invalid ${label} probability distribution for ${id}.`);
		}
		// Laya's confidence is 1 - normalised entropy; answer_confidence matches Jev's meaning.
		const confidence =
			typeof answer.answer_confidence === "number" &&
			answer.answer_confidence >= 0 &&
			answer.answer_confidence <= 1
				? answer.answer_confidence
				: answer.confidence;
		return finding(id, choice, confidence, distribution);
	});
	return { model: raw.model, findings, calibrated: request.provider !== "laya" };
}
