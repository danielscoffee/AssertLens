#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runReview } from "./application/review.ts";
import { createDirectRunner } from "./check/direct.ts";
import { cliGit } from "./git/cli.ts";
import { httpJev } from "./jev/http.ts";
import { renderReport, type Report } from "./report/report.ts";
import { createBubblewrapRunner } from "./sandbox/bubblewrap.ts";
import { nodeProcess } from "./shared/process.ts";

export { review } from "./jev/http.ts";
export { makeRequest } from "./jev/request.ts";
export { renderReport } from "./report/report.ts";

const HELP = `AssertLens — local checks + advisory Jev review (Node 24.12+)\n
Usage: node src/assertlens.ts [options] [-- command args...]\n
  --repo PATH         Repository to review (default: current directory)
  --config PATH       Config relative to repository root (default: .assertlens.json)
  --base REF          Compare against this commit (default: HEAD)
  --head REF          Review committed Git data; commands run in its sandboxed tree
  --snapshot          Allow review even when selected files match the base
  --sandbox-network   Allow network access inside the command sandbox
  --no-sandbox        Run a trusted local command directly (incompatible with --head)
  --dry-run           Print outbound JSON; no API call or command execution
  --json              Emit machine-readable report instead of Markdown
  --help              Show this help\n
Commands use Bubblewrap by default. Only Git-visible files enter the writable sandbox.
Only explicitly selected files are sent to TypeSafe. Inspect --dry-run first.
Exit 0: completed advisory review/help/dry-run; 1: failed check; 2: unavailable review.
`;

function unavailable(error: unknown): Report {
	return {
		mode: "advisory",
		checks: "not_run",
		review: "unavailable",
		findings: [],
		error: error instanceof Error ? error.message : "Unexpected review failure.",
	};
}

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
				"sandbox-network": { type: "boolean" },
				"no-sandbox": { type: "boolean" },
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
		const command = positionals.length
			? (positionals as [string, ...string[]])
			: undefined;
		const sandboxed = !(values["no-sandbox"] ?? false);
		const network = values["sandbox-network"] ?? false;
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
		const result = await runReview(
			{
				git: cliGit,
				checkRunner: sandboxed
					? createBubblewrapRunner(nodeProcess)
					: createDirectRunner(nodeProcess),
				reviewClient: httpJev,
				env: process.env,
			},
			{
				repo: values.repo,
				config: values.config,
				base: values.base,
				head: values.head,
				snapshot: values.snapshot ?? false,
				dryRun: values["dry-run"] ?? false,
				sandboxed,
				network,
				command,
			},
		);
		if (result.kind === "dry-run") {
			process.stderr.write(
				"Dry-run only: no checks executed and no data sent.\n",
			);
			process.stdout.write(`${JSON.stringify(result.request, null, 2)}\n`);
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
