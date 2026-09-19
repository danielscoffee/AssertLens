import type { Config } from "../config/config.ts";

export type Checks = "not_run" | "passed" | "failed";

export type State = {
	base: string;
	head: string;
	checks: Checks;
	files: { path: string; before: string | null; after: string | null }[];
};

export type Workspace = {
	path: string;
	dispose(): void;
};

export type GitCommand = (
	repo: string,
	args: string[],
	maxBuffer?: number,
) => Buffer;

export type GitBlobWriter = (
	repo: string,
	objectId: string,
	destination: string,
) => void;

export type GitPort = {
	repositoryRoot(path: string): string;
	collectState(
		repo: string,
		config: Config,
		baseRef: string,
		headRef?: string,
		snapshot?: boolean,
	): State;
	createWorkspace(repo: string, headRef?: string): Workspace;
};
