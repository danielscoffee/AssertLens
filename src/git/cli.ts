import { closeSync, openSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
	executablePath,
	resolveTrustedExecutable,
} from "../shared/executable.ts";
import { nodeProcess, type ProcessPort } from "../shared/process.ts";
import { MAX_BYTES } from "../shared/validation.ts";
import type {
	GitBlobWriter,
	GitCommand,
	GitPort,
} from "./git.ts";
import { collectState as readState } from "./state.ts";
import { createWorkspace as materializeWorkspace } from "./workspace.ts";

const gitError = () =>
	new Error(
		"Git read failed: check repository, committed base/head, fetch depth, and size limit.",
	);

export function createCliGit(
	process: ProcessPort,
	env: NodeJS.ProcessEnv = globalThis.process.env,
): GitPort {
	const executable = resolveTrustedExecutable("git", env.PATH);
	const gitEnv = {
		PATH: executablePath(executable, env.PATH),
		HOME: "/nonexistent",
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_ATTR_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		GIT_OPTIONAL_LOCKS: "0",
	};
	const safeArgs = [
		"--no-replace-objects",
		"--no-optional-locks",
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"core.fsmonitor=false",
		"-c",
		"core.attributesFile=/dev/null",
		"-c",
		"core.excludesFile=/dev/null",
		"-c",
		"credential.helper=",
	];
	const run = (
		repo: string,
		args: string[],
		maxBuffer = MAX_BYTES,
		stdoutFd?: number,
	) => {
		const result = process.run({
			command: executable,
			args: [...safeArgs, ...args],
			cwd: repo,
			env: gitEnv,
			maxBuffer,
			output: "capture",
			stdoutFd,
			timeout: 10_000,
		});
		if (
			result.error ||
			result.timedOut ||
			result.signal ||
			result.status !== 0
		)
			throw gitError();
		return result.stdout;
	};
	const git: GitCommand = run;
	const writeBlob: GitBlobWriter = (repo, objectId, destination) => {
		const output = openSync(destination, "wx", 0o600);
		try {
			run(repo, ["cat-file", "blob", objectId], MAX_BYTES, output);
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
