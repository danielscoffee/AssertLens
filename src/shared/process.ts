import { spawnSync } from "node:child_process";

export type ProcessRequest = {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	timeout: number;
	output: "capture" | "inherit";
	stdoutFd?: number;
	maxBuffer?: number;
	killSignal?: NodeJS.Signals;
};

export type ProcessResult = {
	status: number | null;
	signal: NodeJS.Signals | null;
	stdout: Buffer;
	stderr: Buffer;
	error?: Error;
	timedOut: boolean;
};

export type ProcessPort = {
	run(request: ProcessRequest): ProcessResult;
};

export const nodeProcess: ProcessPort = {
	run(request) {
		const result = spawnSync(request.command, request.args, {
			cwd: request.cwd,
			env: request.env,
			killSignal: request.killSignal,
			maxBuffer: request.maxBuffer,
			stdio:
				request.output === "inherit"
					? ["ignore", 2, 2]
					: ["ignore", request.stdoutFd ?? "pipe", "pipe"],
			timeout: request.timeout,
		});
		return {
			status: result.status,
			signal: result.signal,
			stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
			stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
			error: result.error,
			timedOut:
				(result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
		};
	},
};
