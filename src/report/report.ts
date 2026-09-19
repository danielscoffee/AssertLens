import type { Checks } from "../git/git.ts";
import type { Finding } from "../jev/jev.ts";

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

export function renderReport(report: Report): string {
	const lines = [
		"# AssertLens — advisory review",
		"",
		`Executable checks: **${report.checks}**. Jev review: **${report.review}**.`,
		"",
		"Model judgments are not correctness proofs or merge approvals.",
		"",
	];
	if (report.base)
		lines.push(
			`Base: ${markdownText(report.base)}. Head: ${markdownText(report.head ?? "")}.`,
			"",
		);
	if (report.scope)
		lines.push(
			`Selected files only: ${report.scope.map(markdownText).join(", ")}. Other files are not reviewed.`,
			"",
		);
	if (report.model) lines.push(`Model: ${markdownText(report.model)}.`, "");
	if (report.error) lines.push(`Error: ${markdownText(report.error)}`, "");
	for (const finding of report.findings) {
		lines.push(
			`- **${markdownText(finding.id)}: ${finding.verdict}** (choice: ${finding.choice}, confidence ${finding.confidence.toFixed(3)}).`,
			`  ${markdownText(report.assertions?.[finding.id] ?? "")}`,
			`  P(supported)=${finding.probabilities.supported.toFixed(3)}, P(contradicted)=${finding.probabilities.contradicted.toFixed(3)}, P(insufficient)=${finding.probabilities.insufficient.toFixed(3)}.`,
		);
	}
	return `${lines.join("\n")}\n`;
}
