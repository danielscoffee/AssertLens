import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { reviewablePath, type Config } from "../config/config.ts";
import { bounded, MAX_BYTES, object } from "../shared/validation.ts";
import { resolveCommit, type GitCommand, type State } from "./git.ts";

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

function committedSource(
	git: GitCommand,
	repo: string,
	ref: string,
	path: string,
): string | null {
	const entry = git(repo, ["ls-tree", "-z", ref, "--", path]).toString(
		"utf8",
	);
	if (!entry) return null;
	const match = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(entry);
	if (!match)
		throw new Error(
			"Only regular files are reviewable; Git symlinks and submodules are rejected.",
		);
	return source(git(repo, ["cat-file", "blob", match[2]]));
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

const MAX_SCOPE_FILES = 50;

// Git-visible files under a folder in either revision, so additions and deletions are kept.
function folderFiles(
	git: GitCommand,
	repo: string,
	base: string,
	head: string | undefined,
	folder: string,
): string[] {
	const listings = [
		git(repo, ["ls-tree", "-r", "-z", "--name-only", base, "--", folder]),
		head
			? git(repo, ["ls-tree", "-r", "-z", "--name-only", head, "--", folder])
			: git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", folder]),
	];
	let names: string[];
	try {
		const decoder = new TextDecoder("utf-8", { fatal: true });
		names = listings.flatMap((bytes) => decoder.decode(bytes).split("\0"));
	} catch {
		throw new Error("Selected folder paths must be UTF-8.");
	}
	const paths = [...new Set(names.filter(Boolean))].sort();
	if (!paths.length) throw new Error("A selected folder has no Git-visible files.");
	return paths.map(reviewablePath);
}

export function collectState(
	git: GitCommand,
	repo: string,
	config: Config,
	baseRef: string,
	headRef?: string,
): State {
	let base = resolveCommit(git, repo, baseRef);
	const head = headRef ? resolveCommit(git, repo, headRef) : "working-tree";
	if (headRef)
		base = git(repo, ["merge-base", base, head]).toString("utf8").trim();
	// ponytail: explicit files and folders only; add dependency discovery when missed-context cases justify it.
	const paths = [
		...new Set(
			config.files.flatMap((entry) =>
				entry.endsWith("/")
					? folderFiles(git, repo, base, headRef && head, entry)
					: [entry],
			),
		),
	];
	if (paths.length > MAX_SCOPE_FILES)
		throw new Error(
			`A scope selects more than ${MAX_SCOPE_FILES} files; narrow its folders.`,
		);
	const files = paths.map((path) => ({
		path,
		before: committedSource(git, repo, base, path),
		after: headRef
			? committedSource(git, repo, head, path)
			: workingSource(repo, path),
	}));
	if (files.some((file) => file.before === null && file.after === null))
		throw new Error("A selected file is missing in both revisions.");
	return { base, head, checks: "not_run", files };
}
