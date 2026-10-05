#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runCheckOnly, runReview, unavailable } from "./application/review.ts";
import { createDirectRunner } from "./check/direct.ts";
import { initConfig } from "./config/init.ts";
import { cliGit } from "./git/cli.ts";
import { httpReview, payload } from "./providers/http.ts";
import { renderReport, type Report } from "./report/report.ts";
import { createBubblewrapRunner } from "./sandbox/bubblewrap.ts";
import { nodeProcess } from "./shared/process.ts";

export { review } from "./providers/http.ts";
export { makeRequest } from "./providers/request.ts";
export { renderReport } from "./report/report.ts";

const HELP = `AssertLens — local checks + advisory Jev review (Node 24.12+)\n
Usage: node src/assertlens.ts [options] [-- command args...]\n
  --repo PATH         Repository to review (default: current directory)
  --config PATH       Config relative to repository root (default: .assertlens.json)
  --base REF          Compare against this commit (default: HEAD)
  --head REF          Review committed Git data; commands run in its sandboxed tree
  --snapshot          Allow review even when selected files match the base
  --check-only        Run the command without configuration or Jev review
  --sandbox-network   Allow network access inside the command sandbox
  --endpoint URL      Self-hosted Laya or OpenAI-compatible endpoint (HTTPS or localhost)
  --no-sandbox        Run a trusted local command directly (incompatible with --head)
  --dry-run           Print outbound JSON; no API call or command execution
  --json              Emit machine-readable report instead of Markdown
  --init              Write a starter .assertlens.json from detected folders
  --help              Show this help\n
Commands use Bubblewrap by default. Only Git-visible files enter the writable sandbox.
Only explicitly selected files are sent to the configured provider. Inspect --dry-run first.
Exit 0: completed advisory review/help/dry-run; 1: failed check; 2: unavailable review;
3: no selected file changed, so nothing was reviewed.
`;

function output(report: Report, json: boolean): void {
	process.stdout.write(
		json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report),
	);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
	let json = args.includes("--json");
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
				"check-only": { type: "boolean" },
				"sandbox-network": { type: "boolean" },
				endpoint: { type: "string" },
				"no-sandbox": { type: "boolean" },
				"dry-run": { type: "boolean" },
				json: { type: "boolean" },
				init: { type: "boolean" },
				help: { type: "boolean" },
			},
		});
		json = values.json ?? false;
		if (values.help) {
			process.stdout.write(HELP);
			return 0;
		}
		const command = positionals.length
			? (positionals as [string, ...string[]])
			: undefined;
		if (values.init) {
			if (command || values["dry-run"] || values["check-only"])
				throw new Error(
					"--init cannot be combined with a command, --dry-run, or --check-only.",
				);
			const repo = cliGit.repositoryRoot(values.repo);
			const path = resolve(repo, values.config);
			initConfig(repo, path);
			process.stdout.write(
				`Wrote ${path}.\nReplace the starter assertions with narrow claims about your code, then inspect the payload:\n  assertlens --snapshot --dry-run\n`,
			);
			return 0;
		}
		const sandboxed = !(values["no-sandbox"] ?? false);
		const network = values["sandbox-network"] ?? false;
		const checkOnly = values["check-only"] ?? false;
		if (checkOnly && (!command || values["dry-run"] || json))
			throw new Error(
				"--check-only requires a command and cannot be combined with --dry-run or --json.",
			);
		if (command && values["dry-run"])
			throw new Error("Commands cannot be combined with --dry-run.");
		if (network && (!command || !sandboxed))
			throw new Error(
				"--sandbox-network requires a sandboxed command.",
			);
		if (command && values.head && !sandboxed)
			throw new Error("--head commands require the sandbox.");
		if (command && !sandboxed)
			process.stderr.write(
				"Warning: command is not sandboxed; run only trusted local code.\n",
			);
		const dependencies = {
			git: cliGit,
			checkRunner: sandboxed
				? createBubblewrapRunner(nodeProcess)
				: createDirectRunner(nodeProcess),
			env: process.env,
		};
		if (checkOnly && command) {
			const result = runCheckOnly(dependencies, {
				repo: values.repo,
				head: values.head,
				sandboxed,
				network,
				command,
			});
			process.stderr.write(
				result.exitCode === 0
					? "Check passed.\n"
					: `Check ${result.exitCode === 1 ? "failed" : "unavailable"}${result.error ? `: ${result.error}` : "."}\n`,
			);
			return result.exitCode;
		}
		const result = await runReview(
			{
				...dependencies,
				reviewClient: httpReview,
			},
			{
				repo: values.repo,
				config: values.config,
				base: values.base,
				head: values.head,
				snapshot: values.snapshot ?? false,
				dryRun: values["dry-run"] ?? false,
				endpoint: values.endpoint,
				sandboxed,
				network,
				command,
			},
		);
		if (result.kind === "dry-run") {
			const endpoints = [...new Set(result.requests.map((r) => r.endpoint))];
			process.stderr.write(
				`Dry-run only: no checks executed and no data sent. ${result.requests.length} request(s) would go to ${endpoints.join(", ")}.\n`,
			);
			process.stdout.write(
				`${JSON.stringify(result.requests.map(payload), null, 2)}\n`,
			);
			return result.exitCode;
		}
		output(result.report, json);
		return result.exitCode;
	} catch (error) {
		output(unavailable(error), json);
		return 2;
	}
}

if (import.meta.main) process.exitCode = await main();
