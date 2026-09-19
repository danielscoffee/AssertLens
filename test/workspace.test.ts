import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createCliGit } from "../src/git/cli.ts";
import type { GitCommand } from "../src/git/git.ts";
import { createWorkspace } from "../src/git/workspace.ts";
import { nodeProcess } from "../src/shared/process.ts";

function fixture(t: TestContext) {
	const repo = mkdtempSync(join(tmpdir(), "assertlens-workspace-test-"));
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.invalid",
				...args,
			],
			{ cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		).trim();
	git("init", "-b", "main");
	writeFileSync(
		join(repo, ".gitignore"),
		".env\nnode_modules/\ntracked-ignored.txt\n",
	);
	writeFileSync(join(repo, "tracked.txt"), "committed\n");
	writeFileSync(join(repo, "tracked-ignored.txt"), "tracked despite ignore\n");
	writeFileSync(join(repo, "deleted.txt"), "present in commit\n");
	writeFileSync(join(repo, "script.sh"), "#!/bin/sh\nexit 0\n");
	chmodSync(join(repo, "script.sh"), 0o755);
	symlinkSync("tracked.txt", join(repo, "link"));
	writeFileSync(join(repo, "binary.bin"), Buffer.from([0, 1, 2, 255]));
	git("add", ".");
	git("add", "-f", "tracked-ignored.txt");
	git("commit", "-qm", "Initial workspace");
	const first = git("rev-parse", "HEAD");
	return { repo, git, first };
}

test("local workspace contains writable Git-visible state without ignored files", (t) => {
	const { repo } = fixture(t);
	writeFileSync(join(repo, "tracked.txt"), "working tree\n");
	rmSync(join(repo, "deleted.txt"));
	writeFileSync(join(repo, "untracked.txt"), "visible\n");
	writeFileSync(join(repo, ".env"), "PRIVATE=value\n");
	mkdirSync(join(repo, "node_modules"));
	writeFileSync(join(repo, "node_modules", "hidden.js"), "secret\n");

	const workspace = createCliGit(nodeProcess).createWorkspace(repo);
	assert.equal(readFileSync(join(workspace.path, "tracked.txt"), "utf8"), "working tree\n");
	assert.equal(readFileSync(join(workspace.path, "untracked.txt"), "utf8"), "visible\n");
	assert.equal(
		readFileSync(join(workspace.path, "tracked-ignored.txt"), "utf8"),
		"tracked despite ignore\n",
	);
	assert.deepEqual(readFileSync(join(workspace.path, "binary.bin")), Buffer.from([0, 1, 2, 255]));
	assert.equal(readlinkSync(join(workspace.path, "link")), "tracked.txt");
	assert.ok(lstatSync(join(workspace.path, "link")).isSymbolicLink());
	assert.notEqual(lstatSync(join(workspace.path, "script.sh")).mode & 0o111, 0);
	assert.equal(existsSync(join(workspace.path, "deleted.txt")), false);
	assert.equal(existsSync(join(workspace.path, ".env")), false);
	assert.equal(existsSync(join(workspace.path, "node_modules")), false);
	assert.equal(existsSync(join(workspace.path, ".git")), false);

	writeFileSync(join(workspace.path, "artifact.txt"), "sandbox output\n");
	assert.equal(existsSync(join(repo, "artifact.txt")), false);
	const path = workspace.path;
	workspace.dispose();
	assert.equal(existsSync(path), false);
});

test("local workspace rejects tracked files beneath replaced symlink directories", (t) => {
	const { repo, git } = fixture(t);
	mkdirSync(join(repo, "dir"));
	writeFileSync(join(repo, "dir", "file.txt"), "tracked\n");
	git("add", "dir/file.txt");
	git("commit", "-qm", "Track nested file");
	const host = mkdtempSync(join(tmpdir(), "assertlens-workspace-host-"));
	t.after(() => rmSync(host, { recursive: true, force: true }));
	writeFileSync(join(host, "file.txt"), "HOST PRIVATE\n");
	rmSync(join(repo, "dir"), { recursive: true });
	symlinkSync(host, join(repo, "dir"));

	assert.throws(
		() => createCliGit(nodeProcess).createWorkspace(repo),
		/symlink|canonical|ancestor/i,
	);
	assert.equal(readFileSync(join(host, "file.txt"), "utf8"), "HOST PRIVATE\n");
});

test("workspace destination rejects symlink ancestors", () => {
	const git: GitCommand = (_repo, args) => {
		if (args[0] === "rev-parse") return Buffer.from("commit\n");
		if (args[0] === "ls-tree")
			return Buffer.from(
				"120000 blob link\tdir\0" +
					"100644 blob file\tdir/file.txt\0",
			);
		if (args[0] === "cat-file") return Buffer.from("/tmp\n");
		throw new Error(`unexpected Git command: ${args.join(" ")}`);
	};
	assert.throws(
		() =>
			createWorkspace(git, () => {
				throw new Error("blob writer must not run");
			}, process.cwd(), "HEAD"),
		/symlink|ancestor/i,
	);
});

test("committed workspace ignores dirty files and preserves Git modes", (t) => {
	const { repo, git, first } = fixture(t);
	writeFileSync(join(repo, "tracked.txt"), "second commit\n");
	writeFileSync(join(repo, "later.txt"), "later\n");
	git("add", ".");
	git("commit", "-qm", "Second workspace");
	writeFileSync(join(repo, "tracked.txt"), "dirty\n");
	writeFileSync(join(repo, "dirty.txt"), "dirty only\n");

	const workspace = createCliGit(nodeProcess).createWorkspace(repo, first);
	t.after(() => workspace.dispose());
	assert.equal(readFileSync(join(workspace.path, "tracked.txt"), "utf8"), "committed\n");
	assert.equal(readFileSync(join(workspace.path, "deleted.txt"), "utf8"), "present in commit\n");
	assert.equal(existsSync(join(workspace.path, "later.txt")), false);
	assert.equal(existsSync(join(workspace.path, "dirty.txt")), false);
	assert.deepEqual(readFileSync(join(workspace.path, "binary.bin")), Buffer.from([0, 1, 2, 255]));
	assert.equal(readlinkSync(join(workspace.path, "link")), "tracked.txt");
	assert.notEqual(lstatSync(join(workspace.path, "script.sh")).mode & 0o111, 0);
	assert.equal(existsSync(join(workspace.path, ".git")), false);
});
