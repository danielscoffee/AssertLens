import assert from "node:assert/strict";
import { test } from "node:test";
import { createDirectRunner } from "../src/check/direct.ts";
import type { ProcessPort, ProcessRequest } from "../src/shared/process.ts";
import { nodeProcess } from "../src/shared/process.ts";

const cwd = process.cwd();

test("node process adapter captures output and exit status", () => {
	const result = nodeProcess.run({
		command: process.execPath,
		args: ["-e", "process.stdout.write('ok'); process.stderr.write('warn')"],
		cwd,
		output: "capture",
		timeout: 1_000,
	});
	assert.equal(result.status, 0);
	assert.equal(result.signal, null);
	assert.equal(result.error, undefined);
	assert.equal(result.timedOut, false);
	assert.equal(result.stdout.toString(), "ok");
	assert.equal(result.stderr.toString(), "warn");
});

test("node process adapter reports nonzero, startup, and timeout failures", () => {
	const nonzero = nodeProcess.run({
		command: process.execPath,
		args: ["-e", "process.exit(7)"],
		cwd,
		output: "capture",
		timeout: 1_000,
	});
	assert.equal(nonzero.status, 7);
	assert.equal(nonzero.error, undefined);

	const missing = nodeProcess.run({
		command: "assertlens-command-that-does-not-exist",
		args: [],
		cwd,
		output: "capture",
		timeout: 1_000,
	});
	assert.equal(missing.status, null);
	assert.ok(missing.error);
	assert.equal(missing.timedOut, false);

	const timeout = nodeProcess.run({
		command: process.execPath,
		args: ["-e", "setTimeout(() => {}, 10_000)"],
		cwd,
		output: "capture",
		timeout: 20,
		killSignal: "SIGKILL",
	});
	assert.equal(timeout.status, null);
	assert.equal(timeout.timedOut, true);
	assert.equal((timeout.error as NodeJS.ErrnoException).code, "ETIMEDOUT");
});

test("direct runner strips service tokens and preserves harmless environment", () => {
	let request: ProcessRequest | undefined;
	const processPort: ProcessPort = {
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
	const result = createDirectRunner(processPort).run({
		command: "test-command",
		args: ["argument"],
		cwd,
		env: {
			SAFE_VALUE: "kept",
			TYPESAFE_API_KEY: "secret",
			GITHUB_TOKEN: "secret",
			GH_TOKEN: "secret",
		},
		network: false,
		timeout: 321,
	});
	assert.equal(result.status, 0);
	assert.ok(request);
	assert.equal(request.command, "test-command");
	assert.deepEqual(request.args, ["argument"]);
	assert.equal(request.cwd, cwd);
	assert.equal(request.timeout, 321);
	assert.equal(request.output, "inherit");
	assert.deepEqual(request.env, { SAFE_VALUE: "kept" });
});
