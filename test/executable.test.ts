import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { createCliGit } from "../src/git/cli.ts";
import { createBubblewrapRunner } from "../src/sandbox/bubblewrap.ts";
import { resolveTrustedExecutable } from "../src/shared/executable.ts";
import {
	nodeProcess,
	type ProcessPort,
	type ProcessRequest,
} from "../src/shared/process.ts";

function fakeExecutable(t: TestContext, name: string) {
	const root = mkdtempSync(join(tmpdir(), "assertlens-host-path-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const marker = join(root, `${name}.executed`);
	const executable = join(root, name);
	writeFileSync(executable, `#!/bin/sh\nprintf executed > ${JSON.stringify(marker)}\nexit 0\n`);
	chmodSync(executable, 0o755);
	return { root, marker, executable };
}

function repository(t: TestContext): string {
	const repo = mkdtempSync(join(tmpdir(), "assertlens-trusted-git-"));
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", repo]);
	return repo;
}

test("trusted executable resolution ignores attacker-writable PATH entries", (t) => {
	const fake = fakeExecutable(t, "git");
	const resolved = resolveTrustedExecutable("git", `${fake.root}:${process.env.PATH ?? ""}`);
	assert.notEqual(resolved, fake.executable);
	assert.equal(resolved, resolveTrustedExecutable("git", dirname(resolved)));
	assert.equal(existsSync(fake.marker), false);
});

test("host Git ignores PATH helpers and receives scrubbed config and environment", (t) => {
	const fake = fakeExecutable(t, "git");
	const repo = repository(t);
	const git = createCliGit(nodeProcess, {
		...process.env,
		PATH: `${fake.root}:${process.env.PATH ?? ""}`,
		TYPESAFE_API_KEY: "secret",
		GITHUB_TOKEN: "secret",
		GIT_ASKPASS: fake.executable,
		SSH_ASKPASS: fake.executable,
	});
	assert.equal(git.repositoryRoot(repo), repo);
	assert.equal(existsSync(fake.marker), false);

	let request: ProcessRequest | undefined;
	const capture: ProcessPort = {
		run(value) {
			request = value;
			return {
				status: 0,
				signal: null,
				stdout: Buffer.from(`${repo}\n`),
				stderr: Buffer.alloc(0),
				timedOut: false,
			};
		},
	};
	createCliGit(capture, {
		PATH: process.env.PATH,
		TYPESAFE_API_KEY: "secret",
		GITHUB_TOKEN: "secret",
		GIT_ASKPASS: fake.executable,
		SSH_ASKPASS: fake.executable,
	}).repositoryRoot(repo);
	assert.ok(request);
	assert.match(request.command, /^\//);
	assert.equal(request.env?.TYPESAFE_API_KEY, undefined);
	assert.equal(request.env?.GITHUB_TOKEN, undefined);
	assert.equal(request.env?.GIT_ASKPASS, undefined);
	assert.equal(request.env?.SSH_ASKPASS, undefined);
	assert.equal(request.env?.GIT_CONFIG_NOSYSTEM, "1");
	assert.equal(request.env?.GIT_CONFIG_GLOBAL, "/dev/null");
	assert.ok(request.args.includes("core.hooksPath=/dev/null"));
	assert.ok(request.args.includes("core.fsmonitor=false"));
	assert.ok(request.args.includes("credential.helper="));
});

test("host Bubblewrap ignores attacker-writable PATH entries or fails closed", (t) => {
	const fake = fakeExecutable(t, "bwrap");
	const path = `${fake.root}:${process.env.PATH ?? ""}`;
	let trusted: string | undefined;
	try {
		trusted = resolveTrustedExecutable("bwrap", path);
		assert.notEqual(trusted, fake.executable);
	} catch {
		trusted = undefined;
	}
	const workspace = mkdtempSync(join(tmpdir(), "assertlens-trusted-bwrap-"));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	let request: ProcessRequest | undefined;
	const capture: ProcessPort = {
		run(value) {
			request = value;
			return {
				status: 0,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.alloc(0),
				timedOut: false,
			};
		},
	};
	const result = createBubblewrapRunner(capture).run({
		command: "/bin/true",
		args: [],
		cwd: workspace,
		env: {
			...process.env,
			PATH: path,
			TYPESAFE_API_KEY: "secret",
			GITHUB_TOKEN: "secret",
		},
		network: false,
		timeout: 5_000,
	});
	assert.equal(existsSync(fake.marker), false);
	if (trusted === undefined) {
		assert.match(result.error?.message ?? "", /trusted.*bwrap|Bubblewrap/i);
		assert.equal(request, undefined);
	} else {
		assert.equal(result.error, undefined);
		assert.equal(request?.command, trusted);
	}
});
