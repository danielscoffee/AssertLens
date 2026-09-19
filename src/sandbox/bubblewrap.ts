import { dirname } from "node:path";
import type { CheckResult, CheckRunner } from "../check/check.ts";
import {
	resolveTrustedExecutable,
	trustedExecutablePath,
} from "../shared/executable.ts";
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
			let executable: string;
			try {
				executable = resolveTrustedExecutable("bwrap", request.env.PATH);
			} catch (error) {
				return unavailable(
					error instanceof Error
						? error.message
						: "No trusted Bubblewrap executable found.",
				);
			}
			return process.run({
				command: executable,
				args: buildBubblewrapArgs(request, policy(request.env)),
				cwd: request.cwd,
				env: {
					PATH: [
						dirname(executable),
						trustedExecutablePath(request.env.PATH),
					]
						.filter(Boolean)
						.join(":"),
					LANG: "C.UTF-8",
				},
				killSignal: "SIGKILL",
				output: "inherit",
				timeout: request.timeout,
			});
		},
	};
}
