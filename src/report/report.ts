import type { Checks } from "../git/git.ts";
import type { Finding } from "../jev/jev.ts";
import { REVIEW_CONFIDENCE } from "../jev/response.ts";

export type Report = {
	mode: "advisory";
	checks: Checks;
	review: "not_run" | "unavailable" | "complete";
	findings: Finding[];
	checkExitCode?: number | null;
	base?: string;
	head?: string;
	scope?: string[];
	assertions?: Record<string, string>;
	model?: string;
	error?: string;
};

function markdownText(text: string): string {
	return text.replace(/[\r\n]/g, " ").replace(/[\\`*_[\]<>|]/g, "\\$&");
}

// Deterministic wording derived from the answer; Jev returns no rationale.
function explain({ choice, verdict, confidence }: Finding): string {
	const at = `confidence ${confidence.toFixed(2)}`;
	if (choice === "insufficient")
		return `Not enough evidence in the selected files (${at}). Add missing dependencies or tests to the scope, or narrow the assertion.`;
	if (verdict === "needs_review")
		return `Leans ${choice}, but ${at} is below the ${REVIEW_CONFIDENCE.toFixed(2)} advisory threshold. Verify manually.`;
	return verdict === "supported"
		? `Selected source supports this assertion (${at}).`
		: `Selected source contains a counterexample (${at}). Inspect the change.`;
}

export function renderReport(report: Report): string {
	const { findings } = report;
	const tally = (["contradicted", "needs_review", "supported"] as const)
		.flatMap((verdict) => {
			const count = findings.filter((f) => f.verdict === verdict).length;
			return count ? [`${count} ${verdict}`] : [];
		})
		.join(", ");
	const lines = [
		"# AssertLens — advisory review",
		"",
		`- Checks: **${report.checks}**`,
		`- Review: **${report.review}**${tally ? ` (${tally})` : ""}`,
	];
	if (report.model) lines.push(`- Model: ${markdownText(report.model)}`);
	if (report.base)
		lines.push(
			`- Compared: ${markdownText(report.base)} → ${markdownText(report.head ?? "")}`,
		);
	if (report.scope)
		lines.push(
			`- Scope: ${report.scope.length} selected files; others are not reviewed: ${report.scope.map(markdownText).join(", ")}`,
		);
	if (report.error) lines.push("", `**Error:** ${markdownText(report.error)}`);
	for (const finding of findings) {
		const { supported, contradicted, insufficient } = finding.probabilities;
		const assertion = report.assertions?.[finding.id];
		lines.push("", `### ${markdownText(finding.id)}: ${finding.verdict}`, "");
		if (assertion) lines.push(`> ${markdownText(assertion)}`, "");
		lines.push(
			explain(finding),
			"",
			`Raw choice: ${finding.choice}, confidence ${finding.confidence.toFixed(3)}. ` +
				`Probabilities: supported ${supported.toFixed(3)}, contradicted ${contradicted.toFixed(3)}, insufficient ${insufficient.toFixed(3)}.`,
		);
	}
	lines.push(
		"",
		"_Model judgments are advisory: not correctness proofs or merge approvals._",
	);
	return `${lines.join("\n")}\n`;
}
