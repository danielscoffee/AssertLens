import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createCliGit } from "../src/git/cli.ts";
import { createBubblewrapRunner } from "../src/sandbox/bubblewrap.ts";
import {
	buildBubblewrapArgs,
	type BubblewrapPolicy,
} from "../src/sandbox/policy.ts";
import { resolveTrustedExecutable } from "../src/shared/executable.ts";
import {
	nodeProcess,
	type ProcessPort,
	type ProcessRequest,
} from "../src/shared/process.ts";

const policy: BubblewrapPolicy = {
	path: "/usr/bin:/nix/store/tool/bin",
	readonlyPaths: ["/usr", "/nix/store", "/etc/ld.so.cache"],
	networkPaths: ["/etc/resolv.conf", "/etc/ssl/certs"],
};

const request = {
	command: "/nix/store/tool/bin/node",
	args: ["--test"],
	cwd: "/host/workspace",
	env: {
		PATH: process.env.PATH,
		CI: "true",
		TERM: "xterm-256color",
		NO_COLOR: "1",
		TYPESAFE_API_KEY: "secret",
	},
	network: false,
	timeout: 1_000,
};

function hasPair(args: string[], option: string, value: string): boolean {
	return args.some(
		(entry, index) => entry === option && args[index + 1] === value,
	);
}

test("Bubblewrap policy isolates namespaces, files, environment, and network", () => {
	const args = buildBubblewrapArgs(request, policy);
	for (const option of [
		"--unshare-user",
		"--unshare-ipc",
		"--unshare-pid",
		"--unshare-uts",
		"--unshare-net",
		"--disable-userns",
		"--new-session",
		"--die-with-parent",
		"--clearenv",
	]) {
		assert.ok(args.includes(option), `missing ${option}`);
	}
	assert.ok(hasPair(args, "--proc", "/proc"));
	assert.ok(hasPair(args, "--dev", "/dev"));
	assert.ok(hasPair(args, "--bind", "/host/workspace"));
	assert.ok(hasPair(args, "--chdir", "/workspace"));
	for (const path of policy.readonlyPaths)
		assert.ok(hasPair(args, "--ro-bind", path), `missing ${path}`);
	for (const path of policy.networkPaths)
		assert.equal(hasPair(args, "--ro-bind", path), false);
	assert.ok(hasPair(args, "--setenv", "PATH"));
	assert.ok(args.includes(policy.path));
	assert.ok(hasPair(args, "--setenv", "HOME"));
	assert.ok(args.includes("/tmp/home"));
	assert.ok(hasPair(args, "--setenv", "CI"));
	assert.ok(hasPair(args, "--setenv", "NO_COLOR"));
	assert.equal(args.includes("TYPESAFE_API_KEY"), false);
	assert.equal(args.some((arg) => arg.startsWith("/home/")), false);
	assert.deepEqual(args.slice(-3), ["--", request.command, ...request.args]);
});

test("network opt-in shares network and mounts only network support paths", () => {
	const args = buildBubblewrapArgs({ ...request, network: true }, policy);
	assert.equal(args.includes("--unshare-net"), false);
	for (const path of policy.networkPaths)
		assert.ok(hasPair(args, "--ro-bind", path), `missing ${path}`);
	assert.equal(args.includes("TYPESAFE_API_KEY"), false);
});

test("Bubblewrap runner invokes bwrap with minimal parent environment", () => {
	let processRequest: ProcessRequest | undefined;
	const processPort: ProcessPort = {
		run(value) {
			processRequest = value;
			return {
				status: 0,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.alloc(0),
				timedOut: false,
			};
		},
	};
	const result = createBubblewrapRunner(
		processPort,
		() => policy,
		"linux",
	).run(request);
	if (result.error) {
		assert.match(result.error.message, /trusted.*bwrap|Bubblewrap/i);
		assert.equal(processRequest, undefined);
		return;
	}
	assert.equal(result.status, 0);
	assert.ok(processRequest);
	assert.match(processRequest.command, /^\//);
	assert.notEqual(processRequest.command, "bwrap");
	assert.equal(processRequest.cwd, request.cwd);
	assert.equal(processRequest.timeout, request.timeout);
	assert.equal(processRequest.output, "inherit");
	assert.equal(processRequest.killSignal, "SIGKILL");
	assert.deepEqual(Object.keys(processRequest.env ?? {}).sort(), ["LANG", "PATH"]);
	assert.equal(processRequest.env?.TYPESAFE_API_KEY, undefined);
	assert.equal(processRequest.env?.GITHUB_TOKEN, undefined);
	assert.deepEqual(processRequest.args, buildBubblewrapArgs(request, policy));
});

test("Bubblewrap runner fails closed off Linux", () => {
	let called = false;
	const processPort: ProcessPort = {
		run() {
			called = true;
			throw new Error("must not execute");
		},
	};
	const result = createBubblewrapRunner(
		processPort,
		() => policy,
		"darwin",
	).run(request);
	assert.equal(result.status, null);
	assert.match(result.error?.message ?? "", /Linux/);
	assert.equal(called, false);
});

let bubblewrap: string | undefined;
try {
	bubblewrap = resolveTrustedExecutable("bwrap");
} catch {
	bubblewrap = undefined;
}
const preflight =
	process.platform === "linux" &&
	bubblewrap !== undefined &&
	nodeProcess.run({
		command: bubblewrap,
		args: [
			"--ro-bind",
			"/",
			"/",
			"--unshare-user",
			"--unshare-pid",
			"--",
			process.execPath,
			"-e",
			"process.exit(0)",
		],
		cwd: process.cwd(),
		env: { PATH: dirname(bubblewrap), LANG: "C.UTF-8" },
		output: "capture",
		timeout: 5_000,
	}).status === 0;

test(
	"real Bubblewrap hides host paths and credentials while keeping workspace writable",
	{ skip: !preflight },
	() => {
		const host = mkdtempSync(join(tmpdir(), "assertlens-sandbox-host-"));
		const workspace = mkdtempSync(join(tmpdir(), "assertlens-sandbox-workspace-"));
		try {
			const secret = join(host, "secret.txt");
			writeFileSync(secret, "private\n");
			const script = [
				"const fs = require('node:fs')",
				`if (fs.existsSync(${JSON.stringify(secret)})) process.exit(11)`,
				"if (process.env.TYPESAFE_API_KEY) process.exit(12)",
				"fs.writeFileSync('artifact.txt', 'ok\\n')",
			].join(";");
			const result = createBubblewrapRunner(nodeProcess).run({
				command: process.execPath,
				args: ["-e", script],
				cwd: workspace,
				env: { ...process.env, TYPESAFE_API_KEY: "secret" },
				network: false,
				timeout: 5_000,
			});
			assert.equal(result.status, 0, result.error?.message);
			assert.equal(readFileSync(join(workspace, "artifact.txt"), "utf8"), "ok\n");
			assert.equal(readFileSync(secret, "utf8"), "private\n");
		} finally {
			rmSync(host, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);

test(
	"real Bubblewrap denies access to host loopback",
	{ skip: !preflight },
	async (t) => {
		const server = spawn(process.execPath, [
			"-e",
			"require('node:net').createServer(socket => socket.end()).listen(0, '127.0.0.1', function () { console.log(this.address().port) })",
		], { stdio: ["ignore", "pipe", "inherit"] });
		t.after(() => server.kill("SIGKILL"));
		const [chunk] = (await once(server.stdout, "data")) as [Buffer];
		const port = Number(chunk.toString("utf8").trim());
		assert.ok(Number.isInteger(port) && port > 0);
		const workspace = mkdtempSync(join(tmpdir(), "assertlens-sandbox-network-"));
		t.after(() => rmSync(workspace, { recursive: true, force: true }));
		const script =
			`const socket=require('node:net').connect(${port},'127.0.0.1');` +
			"socket.on('connect',()=>process.exit(9));" +
			"socket.on('error',()=>process.exit(0));";
		const result = createBubblewrapRunner(nodeProcess).run({
			command: process.execPath,
			args: ["-e", script],
			cwd: workspace,
			env: process.env,
			network: false,
			timeout: 5_000,
		});
		assert.equal(result.status, 0, result.error?.message);
	},
);

test(
	"real Bubblewrap combines disposable staging with host immutability",
	{ skip: !preflight },
	() => {
		const repo = mkdtempSync(join(tmpdir(), "assertlens-sandbox-repo-"));
		try {
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
					{ cwd: repo, stdio: "ignore" },
				);
			git("init", "-b", "main");
			writeFileSync(join(repo, ".gitignore"), ".env\n");
			writeFileSync(join(repo, "tracked.txt"), "host original\n");
			git("add", ".");
			git("commit", "-m", "fixture");
			writeFileSync(join(repo, ".env"), "PRIVATE=value\n");
			const workspace = createCliGit(nodeProcess).createWorkspace(repo);
			try {
				const script = [
					"const fs=require('node:fs')",
					"if(fs.existsSync('.env')||fs.existsSync('.git'))process.exit(11)",
					"fs.writeFileSync('tracked.txt','sandbox change\\n')",
					"fs.writeFileSync('artifact.txt','sandbox only\\n')",
				].join(";");
				const result = createBubblewrapRunner(nodeProcess).run({
					command: process.execPath,
					args: ["-e", script],
					cwd: workspace.path,
					env: process.env,
					network: false,
					timeout: 5_000,
				});
				assert.equal(result.status, 0, result.error?.message);
				assert.equal(
					readFileSync(join(workspace.path, "tracked.txt"), "utf8"),
					"sandbox change\n",
				);
			} finally {
				workspace.dispose();
			}
			assert.equal(readFileSync(join(repo, "tracked.txt"), "utf8"), "host original\n");
			assert.equal(readFileSync(join(repo, ".env"), "utf8"), "PRIVATE=value\n");
			assert.equal(existsSync(join(repo, "artifact.txt")), false);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	},
);

test(
	"real Bubblewrap timeout kills sandbox processes",
	{ skip: !preflight },
	() => {
		const workspace = mkdtempSync(join(tmpdir(), "assertlens-sandbox-timeout-"));
		try {
			const result = createBubblewrapRunner(nodeProcess).run({
				command: process.execPath,
				args: [
					"-e",
					"setTimeout(() => require('node:fs').writeFileSync('late.txt', 'bad'), 200)",
				],
				cwd: workspace,
				env: process.env,
				network: false,
				timeout: 20,
			});
			assert.equal(result.timedOut, true);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
			assert.equal(existsSync(join(workspace, "late.txt")), false);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);
