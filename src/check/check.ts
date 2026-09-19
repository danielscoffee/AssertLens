import type { ProcessResult } from "../shared/process.ts";

export type CheckRequest = {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	network: boolean;
	timeout: number;
};

export type CheckResult = ProcessResult;

export type CheckRunner = {
	run(request: CheckRequest): CheckResult;
};

export function checkPassed(result: CheckResult): boolean {
	return (
		!result.error &&
		!result.timedOut &&
		result.signal === null &&
		result.status === 0
	);
}
