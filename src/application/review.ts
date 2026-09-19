import { resolve } from "node:path";
import type { CheckResult, CheckRunner } from "../check/check.ts";
import { checkPassed } from "../check/check.ts";
import { loadConfig } from "../config/config.ts";
import type { GitPort } from "../git/git.ts";
import type { ReviewClient, ReviewRequest } from "../jev/jev.ts";
import { makeRequest } from "../jev/request.ts";
import type { Report } from "../report/report.ts";

export type ReviewDependencies = {
	git: GitPort;
	checkRunner: CheckRunner;
	reviewClient: ReviewClient;
	env: NodeJS.ProcessEnv;
};

export type ReviewOptions = {
	repo: string;
	config: string;
	base: string;
	head?: string;
	snapshot: boolean;
	dryRun: boolean;
	sandboxed: boolean;
	network: boolean;
	command?: [string, ...string[]];
};

export type CheckOnlyOptions = {
	repo: string;
	head?: string;
	sandboxed: boolean;
	network: boolean;
	command: [string, ...string[]];
};

export type ReviewRun =
	| { kind: "dry-run"; request: ReviewRequest; exitCode: 0 }
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

function executeCheck(
	dependencies: Pick<ReviewDependencies, "git" | "checkRunner" | "env">,
	repo: string,
	options: Pick<
		CheckOnlyOptions,
		"head" | "sandboxed" | "network" | "command"
	>,
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
	dependencies: Pick<ReviewDependencies, "git" | "checkRunner" | "env">,
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
		const state = dependencies.git.collectState(
			repo,
			config,
			options.base,
			options.head,
			options.snapshot,
		);
		Object.assign(report, {
			base: state.base,
			head: state.head,
			scope: config.files,
			assertions: config.assertions,
		});
		if (options.dryRun)
			return { kind: "dry-run", request: makeRequest(config, state), exitCode: 0 };

		if (options.command) {
			const check = executeCheck(dependencies, repo, {
				command: options.command,
				head: options.head,
				sandboxed: options.sandboxed,
				network: options.network,
			});
			report.checkExitCode = check.status;
			report.checks = checkPassed(check) ? "passed" : "failed";
			report.error = checkError(check);
			if (report.checks === "failed")
				return { kind: "report", report, exitCode: 1 };
			if (
				JSON.stringify(
					dependencies.git.collectState(
						repo,
						config,
						options.base,
						options.head,
						options.snapshot,
					),
				) !== JSON.stringify(state)
			) {
				throw new Error(
					"Selected files changed during checks; rerun against a stable snapshot.",
				);
			}
			state.checks = "passed";
		}
		Object.assign(
			report,
			await dependencies.reviewClient.review(
				makeRequest(config, state),
				dependencies.env.TYPESAFE_API_KEY ?? "",
			),
			{ review: "complete" },
		);
		return { kind: "report", report, exitCode: 0 };
	} catch (error) {
		report.review = "unavailable";
		report.error = message(error);
		return { kind: "report", report, exitCode: 2 };
	}
}
