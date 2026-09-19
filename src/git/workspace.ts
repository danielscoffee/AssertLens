import {
	chmodSync,
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readlinkSync,
	readSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { object } from "../shared/validation.ts";
import type {
	GitBlobWriter,
	GitCommand,
	Workspace,
} from "./git.ts";

const WORKSPACE_LIST_BYTES = 64_000_000;

function text(bytes: Buffer, label: string): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`${label} must use UTF-8 paths.`);
	}
}

function destination(root: string, path: string): string {
	const target = resolve(root, path);
	if (!target.startsWith(`${root}${sep}`))
		throw new Error("Git workspace path escapes its temporary root.");
	let directory = root;
	for (const part of dirname(target).slice(root.length + 1).split(sep).filter(Boolean)) {
		directory = join(directory, part);
		try {
			const stat = lstatSync(directory);
			if (stat.isSymbolicLink() || !stat.isDirectory())
				throw new Error("Git workspace destination has a symlink ancestor.");
		} catch (error) {
			if (!object(error) || error.code !== "ENOENT") throw error;
			mkdirSync(directory, { mode: 0o700 });
		}
	}
	return target;
}

function copyPinnedFile(repo: string, source: string, target: string): void {
	const input = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const pinned = fstatSync(input);
		if (!pinned.isFile())
			throw new Error("Git-visible workspace entry must be a regular file.");
		const canonical = realpathSync(source);
		if (
			canonical !== source ||
			!canonical.startsWith(`${repo}${sep}`)
		)
			throw new Error("Git-visible workspace source has a symlink ancestor.");
		const current = statSync(canonical);
		if (current.dev !== pinned.dev || current.ino !== pinned.ino)
			throw new Error("Git-visible workspace source changed while staging.");
		const output = openSync(
			target,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		try {
			const buffer = Buffer.allocUnsafe(64 * 1024);
			for (let bytes = readSync(input, buffer, 0, buffer.length, null); bytes > 0; ) {
				for (let offset = 0; offset < bytes; )
					offset += writeSync(output, buffer, offset, bytes - offset);
				bytes = readSync(input, buffer, 0, buffer.length, null);
			}
			fchmodSync(output, pinned.mode & 0o777);
		} finally {
			closeSync(output);
		}
	} finally {
		closeSync(input);
	}
}

function localWorkspace(git: GitCommand, repo: string, root: string): void {
	const paths = text(
		git(
			repo,
			["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
			WORKSPACE_LIST_BYTES,
		),
		"Git workspace",
	)
		.split("\0")
		.filter(Boolean);
	const canonicalRepo = realpathSync(repo);
	for (const path of paths) {
		const source = resolve(canonicalRepo, path);
		if (!source.startsWith(`${canonicalRepo}${sep}`))
			throw new Error("Git-visible workspace source escapes its repository.");
		let stat;
		try {
			stat = lstatSync(source);
		} catch (error) {
			if (object(error) && error.code === "ENOENT") continue;
			throw error;
		}
		if (stat.isSymbolicLink()) {
			if (realpathSync(dirname(source)) !== dirname(source))
				throw new Error("Git-visible workspace source has a symlink ancestor.");
			const link = readlinkSync(source);
			const current = lstatSync(source);
			if (
				!current.isSymbolicLink() ||
				current.dev !== stat.dev ||
				current.ino !== stat.ino
			)
				throw new Error("Git-visible workspace source changed while staging.");
			symlinkSync(link, destination(root, path));
		} else if (stat.isFile()) {
			copyPinnedFile(canonicalRepo, source, destination(root, path));
		} else {
			throw new Error("Git-visible workspace entries must be files or symlinks.");
		}
	}
}

function committedWorkspace(
	git: GitCommand,
	writeBlob: GitBlobWriter,
	repo: string,
	ref: string,
	root: string,
): void {
	const commit = git(repo, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${ref}^{commit}`,
	])
		.toString("utf8")
		.trim();
	const entries = text(
		git(repo, ["ls-tree", "-rz", "--full-tree", commit], WORKSPACE_LIST_BYTES),
		"Git tree",
	)
		.split("\0")
		.filter(Boolean);
	for (const entry of entries) {
		const tab = entry.indexOf("\t");
		if (tab < 0) throw new Error("Invalid Git tree entry.");
		const [mode, type, objectId] = entry.slice(0, tab).split(" ");
		const path = entry.slice(tab + 1);
		if (mode === "160000" && type === "commit") continue;
		const target = destination(root, path);
		if ((mode === "100644" || mode === "100755") && type === "blob") {
			// ponytail: one Git read per file; use `git cat-file --batch` if staging latency becomes measurable.
			writeBlob(repo, objectId, target);
			chmodSync(target, mode === "100755" ? 0o755 : 0o644);
		} else if (mode === "120000" && type === "blob") {
			const link = text(
				git(repo, ["cat-file", "blob", objectId]),
				"Git symlink",
			);
			symlinkSync(link, target);
		} else {
			throw new Error("Unsupported entry in committed Git workspace.");
		}
	}
}

export function createWorkspace(
	git: GitCommand,
	writeBlob: GitBlobWriter,
	repo: string,
	headRef?: string,
): Workspace {
	const root = mkdtempSync(join(tmpdir(), "assertlens-workspace-"));
	try {
		if (headRef) committedWorkspace(git, writeBlob, repo, headRef, root);
		else localWorkspace(git, repo, root);
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
	return {
		path: root,
		dispose() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}
