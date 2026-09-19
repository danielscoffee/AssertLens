import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config/config.ts";
import { nodeProcess, type ProcessPort } from "../shared/process.ts";
import { MAX_BYTES } from "../shared/validation.ts";
import type { GitCommand, GitPort, State } from "./git.ts";
import { collectState as readState } from "./state.ts";

export function createCliGit(process: ProcessPort): GitPort {
	const git: GitCommand = (repo, ...args) => {
		const result = process.run({
			command: "git",
			args: ["--no-replace-objects", ...args],
			cwd: repo,
			maxBuffer: MAX_BYTES,
			output: "capture",
			timeout: 10_000,
		});
		if (result.error || result.status !== 0)
			throw new Error(
				"Git read failed: check repository, committed base/head, fetch depth, and size limit.",
			);
		return result.stdout;
	};

	return {
		repositoryRoot(path) {
			return realpathSync(
				git(resolve(path), "rev-parse", "--show-toplevel")
					.toString("utf8")
					.trim(),
			);
		},
		collectState(repo, config, baseRef, headRef, snapshot = false) {
			return readState(git, repo, config, baseRef, headRef, snapshot);
		},
	};
}

export const cliGit = createCliGit(nodeProcess);

export function repositoryRoot(path: string): string {
	return cliGit.repositoryRoot(path);
}

export function collectState(
	repo: string,
	config: Config,
	baseRef: string,
	headRef?: string,
	snapshot = false,
): State {
	return cliGit.collectState(repo, config, baseRef, headRef, snapshot);
}
