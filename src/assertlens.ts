#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./config/config.ts";
import { collectState, repositoryRoot } from "./git/cli.ts";
import { review } from "./jev/http.ts";
import { makeRequest } from "./jev/request.ts";
import { renderReport, type Report } from "./report/report.ts";

export { review } from "./jev/http.ts";
export { makeRequest } from "./jev/request.ts";
export { renderReport } from "./report/report.ts";

const HELP = `AssertLens — local checks + advisory Jev review (Node 24.12+)\n
Usage: node src/assertlens.ts [options] [-- trusted-command args...]\n
  --repo PATH       Repository to review (default: current directory)
  --config PATH     Config relative to repository root (default: .assertlens.json)
  --base REF        Compare against this commit (default: HEAD)
  --head REF        Review committed Git data, not working tree; no commands allowed
  --snapshot        Allow review even when selected files match the base
  --dry-run         Print outbound JSON; no API call or command execution
  --json            Emit machine-readable report instead of Markdown
  --help            Show this help\n
Only explicitly selected files are sent to TypeSafe. Inspect --dry-run first.
Exit 0: completed advisory review/help/dry-run; 1: failed check; 2: unavailable review.
`;

export async function main(args = process.argv.slice(2)): Promise<number> {
	const report: Report = {
		mode: "advisory",
		checks: "not_run",
		review: "not_run",
		findings: [],
	};
	let json = args.includes("--json");
	let exitCode = 2;
	try {
		const { values, positionals } = parseArgs({
			args,
			allowPositionals: true,
			options: {
				repo: { type: "string", default: "." },
				config: { type: "string", default: ".assertlens.json" },
				base: { type: "string", default: "HEAD" },
				head: { type: "string" },
				snapshot: { type: "boolean" },
				"dry-run": { type: "boolean" },
				json: { type: "boolean" },
				help: { type: "boolean" },
			},
		});
		json = values.json ?? false;
		if (values.help) {
			process.stdout.write(HELP);
			return 0;
		}
		if (positionals.length && (values.head || values["dry-run"]))
			throw new Error("Commands cannot be combined with --head or --dry-run.");
		const repo = repositoryRoot(values.repo);
		const config = loadConfig(resolve(repo, values.config));
		const state = collectState(
			repo,
			config,
			values.base,
			values.head,
			values.snapshot,
		);
		Object.assign(report, {
			base: state.base,
			head: state.head,
			scope: config.files,
			assertions: config.assertions,
		});
		if (values["dry-run"]) {
			process.stderr.write(
				"Dry-run only: no checks executed and no data sent.\n",
			);
			process.stdout.write(
				`${JSON.stringify(makeRequest(config, state), null, 2)}\n`,
			);
			return 0;
		}
		if (positionals.length) {
			const env = { ...process.env };
			for (const key of ["TYPESAFE_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"])
				delete env[key];
			const check = spawnSync(positionals[0], positionals.slice(1), {
				cwd: repo,
				env,
				shell: false,
				timeout: 120_000,
				stdio: ["ignore", 2, 2],
				// Logs go to stderr so stdout remains a single parseable report.
			});
			report.checkExitCode = check.status;
			report.checks = check.error || check.status !== 0 ? "failed" : "passed";
			if (report.checks === "failed") {
				process.stdout.write(
					json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report),
				);
				return 1;
			}
			if (
				JSON.stringify(
					collectState(repo, config, values.base, values.head, values.snapshot),
				) !== JSON.stringify(state)
			) {
				throw new Error(
					"Selected files changed during checks; rerun against a stable snapshot.",
				);
			}
			state.checks = report.checks;
		}
		Object.assign(
			report,
			await review(
				makeRequest(config, state),
				process.env.TYPESAFE_API_KEY ?? "",
			),
			{ review: "complete" },
		);
		exitCode = 0;
	} catch (error) {
		report.review = "unavailable";
		report.error =
			error instanceof Error ? error.message : "Unexpected review failure.";
	}
	process.stdout.write(
		json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report),
	);
	return exitCode;
}

if (import.meta.main) process.exitCode = await main();
