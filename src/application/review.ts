import { resolve } from "node:path";
import type { CheckResult, CheckRunner } from "../check/check.ts";
import { checkPassed } from "../check/check.ts";
import { loadConfig } from "../config/config.ts";
import type { GitPort } from "../git/git.ts";
import type { Finding, ReviewClient, ReviewRequest } from "../jev/jev.ts";
import { makeRequest } from "../jev/request.ts";
import type { Report } from "../report/report.ts";

type CheckDependencies = {
	git: GitPort;
	checkRunner: CheckRunner;
	env: NodeJS.ProcessEnv;
};

export type ReviewDependencies = CheckDependencies & {
	reviewClient: ReviewClient;
};

export type CheckOnlyOptions = {
	repo: string;
	head?: string;
	sandboxed: boolean;
	network: boolean;
	command: [string, ...string[]];
};

export type ReviewOptions = Omit<CheckOnlyOptions, "command"> & {
	config: string;
	base: string;
	snapshot: boolean;
	dryRun: boolean;
	command?: CheckOnlyOptions["command"];
};

export type ReviewRun =
	| { kind: "dry-run"; requests: ReviewRequest[]; exitCode: 0 }
	| { kind: "report"; report: Report; exitCode: 0 | 1 | 2 };

function emptyReport(): Report {
	return {
		mode: "advisory",
		checks: "not_run",
		review: "not_run",
		findings: [],
	};
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : "Unexpected review failure.";
}

export function unavailable(error: unknown, report = emptyReport()): Report {
	return { ...report, review: "unavailable", error: message(error) };
}

function executeCheck(
	dependencies: CheckDependencies,
	repo: string,
	options: CheckOnlyOptions,
): CheckResult {
	const workspace = options.sandboxed
		? dependencies.git.createWorkspace(repo, options.head)
		: undefined;
	try {
		return dependencies.checkRunner.run({
			command: options.command[0],
			args: options.command.slice(1),
			cwd: workspace?.path ?? repo,
			env: dependencies.env,
			network: options.network,
			timeout: 120_000,
		});
	} finally {
		workspace?.dispose();
	}
}

function checkError(check: CheckResult): string | undefined {
	if (check.timedOut) return "Executable check timed out.";
	if (check.error) return check.error.message;
	if (check.signal) return `Executable check terminated by ${check.signal}.`;
	if (check.status !== 0)
		return `Executable check exited with status ${check.status ?? "unknown"}.`;
	return undefined;
}

export function runCheckOnly(
	dependencies: CheckDependencies,
	options: CheckOnlyOptions,
): { exitCode: 0 | 1 | 2; error?: string } {
	try {
		const repo = dependencies.git.repositoryRoot(options.repo);
		const check = executeCheck(dependencies, repo, options);
		return checkPassed(check)
			? { exitCode: 0 }
			: { exitCode: 1, error: checkError(check) };
	} catch (error) {
		return { exitCode: 2, error: message(error) };
	}
}

export async function runReview(
	dependencies: ReviewDependencies,
	options: ReviewOptions,
): Promise<ReviewRun> {
	const report = emptyReport();
	try {
		const repo = dependencies.git.repositoryRoot(options.repo);
		const config = loadConfig(resolve(repo, options.config));
		const collect = () =>
			config.scopes.map((scope) =>
				dependencies.git.collectState(repo, scope, options.base, options.head),
			);
		const states = collect();
		// Without --snapshot, scopes whose files are all unchanged are skipped.
		const reviewed = config.scopes
			.map((scope, index) => ({ scope, state: states[index] }))
			.filter(
				({ state }) =>
					options.snapshot ||
					state.files.some((file) => file.before !== file.after),
			);
		if (!reviewed.length)
			throw new Error(
				"No changes in selected files; use --snapshot, choose --base, or update configuration.",
			);
		const ids = Object.keys(config.assertions);
		const files: Record<string, string[]> = Object.fromEntries(
			reviewed.flatMap(({ scope, state }) =>
				Object.keys(scope.assertions).map((id) => [
					id,
					state.files.map((file) => file.path),
				]),
			),
		);
		Object.assign(report, {
			base: states[0].base,
			head: states[0].head,
			scope: [...new Set(Object.values(files).flat())],
			assertions: config.assertions,
			files,
			unchanged: ids.filter((id) => !files[id]),
		});
		const requests = () =>
			reviewed.map(({ scope, state }) => makeRequest(scope, state));
		if (options.dryRun)
			return { kind: "dry-run", requests: requests(), exitCode: 0 };

		if (options.command) {
			const check = executeCheck(dependencies, repo, {
				...options,
				command: options.command,
			});
			report.checkExitCode = check.status;
			report.checks = checkPassed(check) ? "passed" : "failed";
			report.error = checkError(check);
			if (report.checks === "failed")
				return { kind: "report", report, exitCode: 1 };
			if (JSON.stringify(collect()) !== JSON.stringify(states))
				throw new Error(
					"Selected files changed during checks; rerun against a stable snapshot.",
				);
			for (const { state } of reviewed) state.checks = "passed";
		}
		// Sequential: the first failure stops further quota use and makes the review unavailable.
		const findings: Finding[] = [];
		const models = new Set<string>();
		for (const request of requests()) {
			const result = await dependencies.reviewClient.review(
				request,
				dependencies.env.TYPESAFE_API_KEY ?? "",
			);
			models.add(result.model);
			findings.push(...result.findings);
		}
		findings.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
		Object.assign(report, {
			model: [...models].join(", "),
			findings,
			review: "complete",
		});
		return { kind: "report", report, exitCode: 0 };
	} catch (error) {
		return { kind: "report", report: unavailable(error, report), exitCode: 2 };
	}
}
