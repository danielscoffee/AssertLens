import { closeSync, openSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config/config.ts";
import { nodeProcess, type ProcessPort } from "../shared/process.ts";
import { MAX_BYTES } from "../shared/validation.ts";
import type {
	GitBlobWriter,
	GitCommand,
	GitPort,
	State,
	Workspace,
} from "./git.ts";
import { collectState as readState } from "./state.ts";
import { createWorkspace as materializeWorkspace } from "./workspace.ts";

const gitError = () =>
	new Error(
		"Git read failed: check repository, committed base/head, fetch depth, and size limit.",
	);

export function createCliGit(process: ProcessPort): GitPort {
	const git: GitCommand = (repo, args, maxBuffer = MAX_BYTES) => {
		const result = process.run({
			command: "git",
			args: ["--no-replace-objects", ...args],
			cwd: repo,
			maxBuffer,
			output: "capture",
			timeout: 10_000,
		});
		if (result.error || result.status !== 0) throw gitError();
		return result.stdout;
	};
	const writeBlob: GitBlobWriter = (repo, objectId, destination) => {
		const output = openSync(destination, "wx", 0o600);
		try {
			const result = process.run({
				command: "git",
				args: ["--no-replace-objects", "cat-file", "blob", objectId],
				cwd: repo,
				maxBuffer: MAX_BYTES,
				output: "capture",
				stdoutFd: output,
				timeout: 10_000,
			});
			if (result.error || result.status !== 0) throw gitError();
		} finally {
			closeSync(output);
		}
	};

	return {
		repositoryRoot(path) {
			return realpathSync(
				git(resolve(path), ["rev-parse", "--show-toplevel"])
					.toString("utf8")
					.trim(),
			);
		},
		collectState(repo, config, baseRef, headRef, snapshot = false) {
			return readState(git, repo, config, baseRef, headRef, snapshot);
		},
		createWorkspace(repo, headRef) {
			return materializeWorkspace(git, writeBlob, repo, headRef);
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

export function createWorkspace(repo: string, headRef?: string): Workspace {
	return cliGit.createWorkspace(repo, headRef);
}
