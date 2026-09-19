import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config/config.ts";
import { MAX_BYTES } from "../shared/validation.ts";
import type { GitPort, State } from "./git.ts";
import { collectState as readState } from "./state.ts";

function git(repo: string, ...args: string[]): Buffer {
	try {
		return execFileSync("git", ["--no-replace-objects", ...args], {
			cwd: repo,
			maxBuffer: MAX_BYTES,
			timeout: 10_000,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		throw new Error(
			"Git read failed: check repository, committed base/head, fetch depth, and size limit.",
		);
	}
}

export function repositoryRoot(path: string): string {
	return realpathSync(
		git(resolve(path), "rev-parse", "--show-toplevel")
			.toString("utf8")
			.trim(),
	);
}

export function collectState(
	repo: string,
	config: Config,
	baseRef: string,
	headRef?: string,
	snapshot = false,
): State {
	return readState(git, repo, config, baseRef, headRef, snapshot);
}

export const cliGit: GitPort = { repositoryRoot, collectState };
