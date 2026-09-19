import type { Config } from "../config/config.ts";

export type Checks = "not_run" | "passed" | "failed";

export type State = {
	base: string;
	head: string;
	checks: Checks;
	files: { path: string; before: string | null; after: string | null }[];
};

export type GitCommand = (repo: string, ...args: string[]) => Buffer;

export type GitPort = {
	repositoryRoot(path: string): string;
	collectState(
		repo: string,
		config: Config,
		baseRef: string,
		headRef?: string,
		snapshot?: boolean,
	): State;
};
