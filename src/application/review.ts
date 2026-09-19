import { resolve } from "node:path";
import type { CheckRunner } from "../check/check.ts";
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
			const workspace = options.sandboxed
				? dependencies.git.createWorkspace(repo, options.head)
				: undefined;
			let check;
			try {
				check = dependencies.checkRunner.run({
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
			report.checkExitCode = check.status;
			report.checks = checkPassed(check) ? "passed" : "failed";
			if (check.error)
				report.error = check.timedOut
					? "Executable check timed out."
					: check.error.message;
			else if (check.signal)
				report.error = `Executable check terminated by ${check.signal}.`;
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
