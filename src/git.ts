import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { bounded, MAX_BYTES, object } from "./validation.ts";

export type Checks = "not_run" | "passed" | "failed";
export type State = {
	base: string;
	head: string;
	checks: Checks;
	files: { path: string; before: string | null; after: string | null }[];
};

function source(bytes: Buffer): string {
	if (bytes.includes(0)) throw new Error("Binary source is not supported.");
	try {
		return bounded(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			"Source",
		);
	} catch {
		throw new Error("Source must be UTF-8 text within the size limit.");
	}
}

function git(repo: string, ...args: string[]): Buffer {
	try {
		return execFileSync("git", ["--no-replace-objects", ...args], {
			cwd: repo,
			maxBuffer: MAX_BYTES,
			timeout: 10_000,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		throw new Error(
			"Git read failed: check repository, committed base/head, fetch depth, and size limit.",
		);
	}
}

export function repositoryRoot(path: string): string {
	return realpathSync(
		git(resolve(path), "rev-parse", "--show-toplevel").toString("utf8").trim(),
	);
}

function committedSource(
	repo: string,
	ref: string,
	path: string,
): string | null {
	const entry = git(repo, "ls-tree", "-z", ref, "--", path).toString("utf8");
	if (!entry) return null;
	const match = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(entry);
	if (!match)
		throw new Error(
			"Only regular files are reviewable; Git symlinks and submodules are rejected.",
		);
	return source(git(repo, "cat-file", "blob", match[2]));
}

function workingSource(repo: string, path: string): string | null {
	const absolute = resolve(repo, path);
	try {
		const stat = lstatSync(absolute);
		if (!stat.isFile() || realpathSync(absolute) !== absolute)
			throw new Error("Selected symlinks and non-regular files are rejected.");
		if (stat.size > MAX_BYTES) throw new Error("Source exceeds size limit.");
		return source(readFileSync(absolute));
	} catch (error) {
		if (object(error) && error.code === "ENOENT") return null;
		throw error;
	}
}

export function collectState(
	repo: string,
	config: Config,
	baseRef: string,
	headRef?: string,
): State {
	let base = git(
		repo,
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${baseRef}^{commit}`,
	)
		.toString("utf8")
		.trim();
	const head = headRef
		? git(
				repo,
				"rev-parse",
				"--verify",
				"--end-of-options",
				`${headRef}^{commit}`,
			)
				.toString("utf8")
				.trim()
		: "working-tree";
	if (headRef)
		base = git(repo, "merge-base", base, head).toString("utf8").trim();
	// ponytail: explicit files only; add dependency discovery when missed-context cases justify it.
	const files = config.files.map((path) => ({
		path,
		before: committedSource(repo, base, path),
		after: headRef
			? committedSource(repo, head, path)
			: workingSource(repo, path),
	}));
	if (files.some((file) => file.before === null && file.after === null))
		throw new Error("A selected file is missing in both revisions.");
	if (files.every((file) => file.before === file.after))
		throw new Error(
			"No changes in selected files; choose --base or update configuration.",
		);
	return { base, head, checks: "not_run", files };
}
