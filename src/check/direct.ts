import type { ProcessPort } from "../shared/process.ts";
import type { CheckRunner } from "./check.ts";

const SERVICE_TOKENS = ["TYPESAFE_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"];

export function createDirectRunner(process: ProcessPort): CheckRunner {
	return {
		run(request) {
			const env = { ...request.env };
			for (const key of SERVICE_TOKENS) delete env[key];
			return process.run({
				command: request.command,
				args: request.args,
				cwd: request.cwd,
				env,
				output: "inherit",
				timeout: request.timeout,
			});
		},
	};
}
