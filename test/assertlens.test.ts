import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../src/assertlens.ts", import.meta.url));
const original = "export const eligible = (age: number) => age >= 18;\n";
const changed = "export const eligible = (age: number) => age > 18;\n";
const config = {
	model: "jev-1.13.0",
	files: ["sample.ts"],
	assertions: { age_boundary: "An 18-year-old is eligible." },
};

function fakeBubblewrap(t: TestContext): NodeJS.ProcessEnv {
	const root = mkdtempSync(join(tmpdir(), "assertlens-fake-bwrap-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const executable = join(root, "bwrap");
	writeFileSync(
		executable,
		`#!${process.execPath}\n` +
			`const { spawnSync } = require("node:child_process");\n` +
			`const args = process.argv.slice(2);\n` +
			`const separator = args.lastIndexOf("--");\n` +
			`const bind = args.findIndex((value, index) => value === "--bind" && args[index + 2] === "/workspace");\n` +
			`const env = {};\n` +
			`for (let index = 0; index < separator; index++) if (args[index] === "--setenv") env[args[index + 1]] = args[index + 2];\n` +
			`const result = spawnSync(args[separator + 1], args.slice(separator + 2), { cwd: args[bind + 1], env, stdio: "inherit" });\n` +
			`if (result.error) { console.error(result.error.message); process.exit(127); }\n` +
			`process.exit(result.status ?? 1);\n`,
	);
	chmodSync(executable, 0o755);
	return { PATH: `${root}:${process.env.PATH ?? ""}` };
}

function withoutBubblewrap(t: TestContext): NodeJS.ProcessEnv {
	const root = mkdtempSync(join(tmpdir(), "assertlens-no-bwrap-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const gitDirectory = (process.env.PATH ?? "")
		.split(":")
		.find((path) => existsSync(join(path, "git")));
	assert.ok(gitDirectory, "git must be available for CLI tests");
	symlinkSync(join(gitDirectory, "git"), join(root, "git"));
	return { PATH: root };
}

function fixture(t: TestContext) {
	const repo = mkdtempSync(join(tmpdir(), "assertlens-test-"));
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
	const write = (path: string, content: string) =>
		writeFileSync(join(repo, path), content);
	git("init", "-b", "main");
	write("sample.ts", original);
	write(".assertlens.json", JSON.stringify(config));
	git("add", ".");
	git("commit", "-qm", "Initial sample");
	write("sample.ts", changed);
	const runWithEnv = (env: NodeJS.ProcessEnv, ...args: string[]) =>
		spawnSync(process.execPath, [cliPath, "--repo", repo, ...args], {
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				TYPESAFE_API_KEY: "",
				GITHUB_TOKEN: "",
				GH_TOKEN: "",
				...env,
			},
		});
	const run = (...args: string[]) => runWithEnv({}, ...args);
	return { repo, git, write, run, runWithEnv };
}

test("dry-run captures before/after source without credentials or execution", (t) => {
	const { run } = fixture(t);
	const result = run("--dry-run");
	assert.equal(result.status, 0, result.stderr);
	const request = JSON.parse(result.stdout);
	assert.equal(request.model, config.model);
	assert.deepEqual(request.state.files, [
		{ path: "sample.ts", before: original, after: changed },
	]);
	assert.equal(request.state.checks, "not_run");
	assert.deepEqual(Object.keys(request.questions), ["age_boundary"]);
	assert.equal(request.questions.age_boundary.type, "choice");
	assert.ok(request.questions.age_boundary.criteria.insufficient);
	assert.match(result.stderr, /dry.run/i);
});

test("snapshot dry-run reviews unchanged files without relaxing the default", (t) => {
	const { run, write } = fixture(t);
	write("sample.ts", original);
	const normal = run("--json", "--dry-run");
	assert.equal(normal.status, 2);
	assert.match(JSON.parse(normal.stdout).error, /--snapshot/);
	const snapshot = run("--snapshot", "--dry-run");
	assert.equal(snapshot.status, 0, snapshot.stderr);
	const request = JSON.parse(snapshot.stdout);
	assert.deepEqual(request.state.files, [
		{ path: "sample.ts", before: original, after: original },
	]);
	assert.equal(request.state.checks, "not_run");
});

test("committed snapshot runs sandboxed commands against committed source", (t) => {
	const { run, runWithEnv } = fixture(t);
	const result = run("--snapshot", "--head", "HEAD", "--dry-run");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).state.files[0].after, original);
	const command = runWithEnv(
		fakeBubblewrap(t),
		"--snapshot",
		"--head",
		"HEAD",
		"--json",
		"--",
		process.execPath,
		"-e",
		`process.exit(require("node:fs").readFileSync("sample.ts", "utf8") === ${JSON.stringify(original)} ? 0 : 9)`,
	);
	assert.equal(command.status, 2, command.stderr);
	const report = JSON.parse(command.stdout);
	assert.equal(report.checks, "passed");
	assert.match(report.error, /TYPESAFE_API_KEY/);
});

test("snapshot mode preserves executable check and missing-key failures", (t) => {
	const { run, write } = fixture(t);
	write("sample.ts", original);
	const failed = run(
		"--snapshot",
		"--no-sandbox",
		"--json",
		"--",
		process.execPath,
		"-e",
		"process.exit(7)",
	);
	assert.equal(failed.status, 1, failed.stderr);
	assert.equal(JSON.parse(failed.stdout).checks, "failed");
	assert.equal(JSON.parse(failed.stdout).review, "not_run");
	const passed = run(
		"--snapshot",
		"--no-sandbox",
		"--json",
		"--",
		process.execPath,
		"-e",
		"process.exit(0)",
	);
	assert.equal(passed.status, 2, passed.stderr);
	const report = JSON.parse(passed.stdout);
	assert.equal(report.checks, "passed");
	assert.equal(report.review, "unavailable");
	assert.match(report.error, /TYPESAFE_API_KEY/);
});

test("snapshot mode rejects source changes made during checks", (t) => {
	const { run, write } = fixture(t);
	write("sample.ts", original);
	const result = run(
		"--snapshot",
		"--no-sandbox",
		"--json",
		"--",
		process.execPath,
		"-e",
		'require("node:fs").writeFileSync("sample.ts", "changed during check")',
	);
	assert.equal(result.status, 2, result.stderr);
	assert.match(JSON.parse(result.stdout).error, /changed during/i);
});

test("selected untracked files are reviewed, unrelated files are not read", (t) => {
	const { run, write } = fixture(t);
	write("new.ts", "export const answer = 42;\n");
	write(
		".assertlens.json",
		JSON.stringify({ ...config, files: ["sample.ts", "new.ts"] }),
	);
	write("unrelated.txt", "not selected");
	const result = run("--dry-run");
	assert.equal(result.status, 0, result.stderr);
	const files = JSON.parse(result.stdout).state.files;
	assert.equal(files.length, 2);
	assert.equal(files[1].before, null);
	assert.equal(files[1].after, "export const answer = 42;\n");
	assert.ok(!result.stdout.includes("not selected"));
});

test("committed-head review ignores dirty local source and uses merge base", (t) => {
	const { git, run, write } = fixture(t);
	const base = git("rev-parse", "HEAD");
	git("switch", "-c", "feature");
	git("add", "sample.ts");
	git("commit", "-qm", "Change boundary");
	const head = git("rev-parse", "HEAD");
	git("switch", "main");
	write("sample.ts", "export const eligible = () => false;\n");
	git("add", "sample.ts");
	git("commit", "-qm", "Independent base change");
	write("sample.ts", "dirty source must not be sent");
	const result = run("--base", "main", "--head", head, "--dry-run");
	assert.equal(result.status, 0, result.stderr);
	const state = JSON.parse(result.stdout).state;
	assert.equal(state.base, base);
	assert.equal(state.head, head);
	assert.equal(state.files[0].before, original);
	assert.equal(state.files[0].after, changed);
});

test("a failed executable check remains failed and skips Jev", (t) => {
	const { run } = fixture(t);
	const result = run(
		"--no-sandbox",
		"--json",
		"--",
		process.execPath,
		"-e",
		'console.log("check log"); process.exit(7)',
	);
	assert.equal(result.status, 1, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.checks, "failed");
	assert.equal(report.review, "not_run");
	assert.equal(report.checkExitCode, 7);
	assert.deepEqual(report.findings, []);
	assert.match(result.stderr, /check log/);
});

test("successful local check cannot mask missing API credentials", (t) => {
	const { run } = fixture(t);
	const result = run(
		"--no-sandbox",
		"--json",
		"--",
		process.execPath,
		"-e",
		"process.exit(0)",
	);
	assert.equal(result.status, 2, result.stderr);
	assert.match(result.stderr, /not sandboxed|unsafe/i);
	const report = JSON.parse(result.stdout);
	assert.equal(report.checks, "passed");
	assert.equal(report.review, "unavailable");
	assert.match(report.error, /TYPESAFE_API_KEY/);
});

test("changes made during checks invalidate their evidence", (t) => {
	const { run } = fixture(t);
	const result = run(
		"--no-sandbox",
		"--json",
		"--",
		process.execPath,
		"-e",
		'require("node:fs").writeFileSync("sample.ts", "changed during check")',
	);
	assert.equal(result.status, 2, result.stderr);
	assert.match(JSON.parse(result.stdout).error, /changed during/i);
});

test("sandboxed checks mutate only their disposable workspace", (t) => {
	const { repo, runWithEnv } = fixture(t);
	const result = runWithEnv(
		fakeBubblewrap(t),
		"--json",
		"--",
		process.execPath,
		"-e",
		'require("node:fs").writeFileSync("sample.ts", "sandbox mutation")',
	);
	assert.equal(result.status, 2, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.checks, "passed");
	assert.match(report.error, /TYPESAFE_API_KEY/);
	assert.equal(readFileSync(join(repo, "sample.ts"), "utf8"), changed);
});

test("missing Bubblewrap fails the check without calling Jev", (t) => {
	const { runWithEnv } = fixture(t);
	const result = runWithEnv(
		withoutBubblewrap(t),
		"--json",
		"--",
		process.execPath,
		"-e",
		"process.exit(0)",
	);
	assert.equal(result.status, 1, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.checks, "failed");
	assert.equal(report.review, "not_run");
	assert.match(report.error, /bwrap|ENOENT/i);
});

test("sandbox flags reject unsafe or meaningless combinations", (t) => {
	const { run } = fixture(t);
	for (const args of [
		["--sandbox-network"],
		[
			"--sandbox-network",
			"--no-sandbox",
			"--",
			process.execPath,
			"-e",
			"process.exit(0)",
		],
	]) {
		const result = run("--json", ...args);
		assert.equal(result.status, 2, result.stderr);
		assert.match(JSON.parse(result.stdout).error, /sandbox|command/i);
	}
});

test("dry-run and direct head mode never execute a supplied command", (t) => {
	const { run } = fixture(t);
	for (const args of [["--head", "HEAD", "--no-sandbox"], ["--dry-run"]]) {
		const result = run(
			"--json",
			...args,
			"--",
			process.execPath,
			"-e",
			"process.exit(19)",
		);
		assert.equal(result.status, 2, result.stderr);
		assert.match(JSON.parse(result.stdout).error, /command|sandbox/i);
	}
});

test("invalid configuration, sensitive paths, symlinks, and oversized source fail closed", (t) => {
	const { run, write, repo } = fixture(t);
	for (const invalid of [
		{ ...config, assertions: {} },
		{ ...config, assertions: { bad: "" } },
		{ ...config, files: ["../outside.ts"] },
		{ ...config, files: [".env"] },
		{ ...config, files: ["private.pem"] },
		{ ...config, files: [".git/config"] },
		{ ...config, files: ["sample.ts"], typo: true },
	]) {
		write(".assertlens.json", JSON.stringify(invalid));
		const result = run("--json", "--dry-run");
		assert.equal(result.status, 2, result.stderr);
		assert.equal(JSON.parse(result.stdout).review, "unavailable");
	}
	write(".assertlens.json", JSON.stringify({ ...config, files: ["link.ts"] }));
	symlinkSync(join(repo, "sample.ts"), join(repo, "link.ts"));
	assert.equal(run("--dry-run").status, 2);
	write(".assertlens.json", JSON.stringify(config));
	write("sample.ts", "x".repeat(100_001));
	const oversized = run("--json", "--dry-run");
	assert.equal(oversized.status, 2);
	assert.match(JSON.parse(oversized.stdout).error, /large|limit/i);
});

test("binary content, missing paths, and unchanged scope are not successful reviews", (t) => {
	const { run, write } = fixture(t);
	for (const source of ["\0binary", original]) {
		write("sample.ts", source);
		assert.equal(run("--dry-run").status, 2);
	}
	write(
		".assertlens.json",
		JSON.stringify({ ...config, files: ["missing.ts"] }),
	);
	assert.equal(run("--dry-run").status, 2);
});

test("committed invalid UTF-8 is rejected instead of silently replaced", (t) => {
	const { repo, git, run } = fixture(t);
	writeFileSync(join(repo, "sample.ts"), Buffer.from([0xff, 0xfe]));
	git("add", "sample.ts");
	git("commit", "-qm", "Invalid source encoding");
	const result = run(
		"--base",
		"HEAD~1",
		"--head",
		"HEAD",
		"--json",
		"--dry-run",
	);
	assert.equal(result.status, 2, result.stderr);
	assert.match(JSON.parse(result.stdout).error, /UTF-8/);
});

function answer(choice = "supported", confidence = 0.95) {
	return {
		model: "jev-1.13.0",
		answers: {
			age_boundary: {
				type: "choice",
				choice,
				confidence,
				probabilities: Object.fromEntries(
					["supported", "contradicted", "insufficient"].map((option) => [
						option,
						option === choice ? 0.96 : 0.02,
					]),
				),
			},
		},
		usage: { input_tokens: 100, output_tokens: 30 },
	};
}

test("HTTP contract batches questions and reports valid judgments as advisory", async (t) => {
	const { makeRequest, review } = await import("../src/assertlens.ts");
	const request = makeRequest(config, {
		base: "base",
		head: "working-tree",
		checks: "not_run",
		files: [{ path: "sample.ts", before: original, after: changed }],
	});
	t.mock.method(
		globalThis,
		"fetch",
		async (input: string | URL | Request, init?: RequestInit) => {
			assert.equal(input, "https://api.typesafe.ai/v1/systemone");
			assert.equal(init?.method, "POST");
			assert.equal(init?.redirect, "error");
			assert.equal(
				new Headers(init?.headers).get("Authorization"),
				"Bearer test-only-token",
			);
			assert.deepEqual(JSON.parse(String(init?.body)), request);
			assert.ok(init?.signal);
			return Response.json(answer("contradicted"));
		},
	);
	const result = await review(request, "test-only-token");
	assert.equal(result.model, "jev-1.13.0");
	assert.equal(result.findings[0].verdict, "contradicted");
	assert.equal(result.findings[0].probabilities.contradicted, 0.96);
});

test("uncertainty and insufficient evidence always request human review", async (t) => {
	const { makeRequest, review } = await import("../src/assertlens.ts");
	const request = makeRequest(config, {
		base: "base",
		head: "working-tree",
		checks: "not_run",
		files: [{ path: "sample.ts", before: original, after: changed }],
	});
	for (const response of [
		answer("supported", 0.79),
		answer("insufficient", 0.99),
	]) {
		const stub = t.mock.method(globalThis, "fetch", async () =>
			Response.json(response),
		);
		assert.equal(
			(await review(request, "test-only-token")).findings[0].verdict,
			"needs_review",
		);
		stub.mock.restore();
	}
});

test("Markdown retains the raw choice when uncertainty changes the verdict", async () => {
	const { renderReport } = await import("../src/assertlens.ts");
	const report = renderReport({
		mode: "advisory",
		checks: "passed",
		review: "complete",
		findings: [
			{
				id: "age_boundary",
				choice: "contradicted",
				verdict: "needs_review",
				confidence: 0.7,
				probabilities: {
					supported: 0.15,
					contradicted: 0.8,
					insufficient: 0.05,
				},
			},
		],
	});
	assert.match(report, /needs_review/);
	assert.match(report, /choice: contradicted/);
});

test("missing, malformed, and contradictory API answers cannot become findings", async (t) => {
	const { makeRequest, review } = await import("../src/assertlens.ts");
	const request = makeRequest(config, {
		base: "base",
		head: "working-tree",
		checks: "not_run",
		files: [{ path: "sample.ts", before: original, after: changed }],
	});
	const incomplete = answer();
	const wrongType = answer();
	wrongType.answers.age_boundary.type = "noul";
	const badDistribution = answer();
	badDistribution.answers.age_boundary.probabilities.supported = 0.1;
	const wrongWinner = answer();
	wrongWinner.answers.age_boundary.choice = "contradicted";
	for (const response of [
		null,
		{},
		{ ...incomplete, answers: {} },
		wrongType,
		badDistribution,
		wrongWinner,
		answer("supported", 2),
		answer("supported", Number.NaN),
	]) {
		const stub = t.mock.method(globalThis, "fetch", async () =>
			Response.json(response),
		);
		await assert.rejects(
			review(request, "test-only-token"),
			/invalid|missing|malformed/i,
		);
		stub.mock.restore();
	}
});

test("service failure hides response bodies, missing keys make no network request", async (t) => {
	const { makeRequest, review } = await import("../src/assertlens.ts");
	const request = makeRequest(config, {
		base: "base",
		head: "working-tree",
		checks: "not_run",
		files: [{ path: "sample.ts", before: original, after: changed }],
	});
	const stub = t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("private service detail", { status: 429 }),
	);
	await assert.rejects(review(request, ""), /TYPESAFE_API_KEY/);
	assert.equal(stub.mock.callCount(), 0);
	await assert.rejects(review(request, "test-only-token"), (error: Error) => {
		assert.match(error.message, /429/);
		assert.ok(!error.message.includes("private service detail"));
		return true;
	});
	assert.equal(stub.mock.callCount(), 1);
});

test("complete CLI review remains advisory and strips service tokens from local checks", async (t) => {
	const { main } = await import("../src/assertlens.ts");
	const { repo } = fixture(t);
	const oldKey = process.env.TYPESAFE_API_KEY;
	process.env.TYPESAFE_API_KEY = "test-only-token";
	t.after(() => {
		if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
		else process.env.TYPESAFE_API_KEY = oldKey;
	});
	let output = "";
	const stdout = t.mock.method(
		process.stdout,
		"write",
		(chunk: string | Uint8Array) => {
			output += chunk;
			return true;
		},
	);
	const fetch = t.mock.method(globalThis, "fetch", async () =>
		Response.json(answer("contradicted")),
	);
	t.mock.method(process.stderr, "write", () => true);
	const exit = await main([
		"--repo",
		repo,
		"--no-sandbox",
		"--json",
		"--",
		process.execPath,
		"-e",
		'process.exit(["TYPESAFE_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"].some(k => k in process.env) ? 9 : 0)',
	]);
	stdout.mock.restore();
	assert.equal(exit, 0);
	const report = JSON.parse(output);
	assert.equal(report.mode, "advisory");
	assert.equal(report.review, "complete");
	assert.equal(report.checks, "passed");
	assert.equal(report.findings[0].verdict, "contradicted");
	assert.equal(fetch.mock.callCount(), 1);
});

test("malformed, oversized, and disconnected HTTP responses fail closed", async (t) => {
	const { makeRequest, review } = await import("../src/assertlens.ts");
	const request = makeRequest(config, {
		base: "base",
		head: "working-tree",
		checks: "not_run",
		files: [{ path: "sample.ts", before: original, after: changed }],
	});
	for (const body of ["not json", "x".repeat(100_001)]) {
		const stub = t.mock.method(
			globalThis,
			"fetch",
			async () => new Response(body),
		);
		await assert.rejects(
			review(request, "test-only-token"),
			/invalid|malformed/i,
		);
		stub.mock.restore();
	}
	t.mock.method(globalThis, "fetch", async () => {
		throw new Error("private transport detail");
	});
	await assert.rejects(
		review(request, "test-only-token"),
		/network request failed or timed out/,
	);
});

test("modules compose a local review request without the CLI", async (t) => {
	const { loadConfig } = await import("../src/config/config.ts");
	const { repositoryRoot, collectState } = await import("../src/git/cli.ts");
	const { makeRequest } = await import("../src/jev/request.ts");
	const { repo } = fixture(t);
	const root = repositoryRoot(repo);
	const settings = loadConfig(join(root, ".assertlens.json"));
	const state = collectState(root, settings, "HEAD");
	const request = makeRequest(settings, state);
	assert.equal(root, repo);
	assert.equal(request.model, config.model);
	assert.deepEqual(request.state.files, [
		{ path: "sample.ts", before: original, after: changed },
	]);
	assert.equal(request.state.checks, "not_run");
});

test("entry point preserves existing public exports", async () => {
	const cli = await import("../src/assertlens.ts");
	const request = await import("../src/jev/request.ts");
	const http = await import("../src/jev/http.ts");
	const report = await import("../src/report/report.ts");
	assert.equal(cli.makeRequest, request.makeRequest);
	assert.equal(cli.review, http.review);
	assert.equal(cli.renderReport, report.renderReport);
});

test("self-review scope includes every runtime module", () => {
	const settings = JSON.parse(
		readFileSync(new URL("../.assertlens.json", import.meta.url), "utf8"),
	);
	const modules = readdirSync(new URL("../src/", import.meta.url), {
		encoding: "utf8",
		recursive: true,
	})
		.filter((path) => path.endsWith(".ts"))
		.map((path) => `src/${path}`);
	assert.deepEqual([...settings.files].sort(), modules.sort());
});

test("AssertLens package uses TypeScript directly", () => {
	const manifest = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	);
	assert.equal(manifest.name, "assertlens");
	assert.deepEqual(manifest.bin, { assertlens: "./src/assertlens.ts" });
	assert.equal(manifest.scripts.typecheck, "tsc --noEmit");
	assert.equal(manifest.scripts.review, "node src/assertlens.ts");
	assert.equal(manifest.dependencies, undefined);
});

test("CLI help and reports use AssertLens", async (t) => {
	const { renderReport } = await import("../src/assertlens.ts");
	const { run } = fixture(t);
	const help = run("--help");
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /^AssertLens —/);
	assert.match(help.stdout, /Usage: node src\/assertlens\.ts/);
	assert.match(help.stdout, /default: \.assertlens\.json/);
	assert.match(
		renderReport({
			mode: "advisory",
			checks: "not_run",
			review: "not_run",
			findings: [],
		}),
		/^# AssertLens — advisory review\n/,
	);
});
