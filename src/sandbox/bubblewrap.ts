import type { CheckResult, CheckRunner } from "../check/check.ts";
import type { ProcessPort } from "../shared/process.ts";
import {
	buildBubblewrapArgs,
	systemBubblewrapPolicy,
	type BubblewrapPolicy,
} from "./policy.ts";

function unavailable(message: string): CheckResult {
	return {
		status: null,
		signal: null,
		stdout: Buffer.alloc(0),
		stderr: Buffer.alloc(0),
		error: new Error(message),
		timedOut: false,
	};
}

export function createBubblewrapRunner(
	process: ProcessPort,
	policy: (env: NodeJS.ProcessEnv) => BubblewrapPolicy =
		systemBubblewrapPolicy,
	platform: NodeJS.Platform = globalThis.process.platform,
): CheckRunner {
	return {
		run(request) {
			if (platform !== "linux")
				return unavailable("Bubblewrap sandbox requires Linux.");
			return process.run({
				command: "bwrap",
				args: buildBubblewrapArgs(request, policy(request.env)),
				cwd: request.cwd,
				env: request.env.PATH ? { PATH: request.env.PATH } : {},
				killSignal: "SIGKILL",
				output: "inherit",
				timeout: request.timeout,
			});
		},
	};
}
