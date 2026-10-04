import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
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
	const run = (...args: string[]) =>
		spawnSync(process.execPath, [cliPath, "--repo", repo, ...args], {
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				TYPESAFE_API_KEY: "",
				GITHUB_TOKEN: "",
				GH_TOKEN: "",
			},
		});
	return { repo, git, write, run };
}

test("dry-run captures before/after source without credentials or execution", (t) => {
	const { run } = fixture(t);
	const result = run("--dry-run");
	assert.equal(result.status, 0, result.stderr);
	const requests = JSON.parse(result.stdout);
	assert.equal(requests.length, 1);
	const [request] = requests;
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
	const [request] = JSON.parse(snapshot.stdout);
	assert.deepEqual(request.state.files, [
		{ path: "sample.ts", before: original, after: original },
	]);
	assert.equal(request.state.checks, "not_run");
});

test("committed snapshot reads committed source", (t) => {
	const { run } = fixture(t);
	const result = run("--snapshot", "--head", "HEAD", "--dry-run");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout)[0].state.files[0].after, original);
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
	const files = JSON.parse(result.stdout)[0].state.files;
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
	const state = JSON.parse(result.stdout)[0].state;
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

test("timeout or signal with zero status skips review", async (t) => {
	const { runReview } = await import("../src/application/review.ts");
	const { createCliGit } = await import("../src/git/cli.ts");
	const { nodeProcess } = await import("../src/shared/process.ts");
	const { repo } = fixture(t);
	for (const failure of [
		{ timedOut: true, signal: null },
		{ timedOut: false, signal: "SIGKILL" as const },
	]) {
		let reviewCalls = 0;
		const result = await runReview(
			{
				git: createCliGit(nodeProcess),
				checkRunner: {
					run: () => ({
						status: 0,
						signal: failure.signal,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
						timedOut: failure.timedOut,
					}),
				},
				reviewClient: {
					async review() {
						reviewCalls++;
						return { model: "unused", findings: [] };
					},
				},
				env: { TYPESAFE_API_KEY: "unused" },
			},
			{
				repo,
				config: ".assertlens.json",
				base: "HEAD",
				snapshot: false,
				dryRun: false,
				sandboxed: false,
				network: false,
				command: ["unused"],
			},
		);
		assert.equal(result.exitCode, 1);
		assert.equal(result.kind, "report");
		assert.equal(result.report.checks, "failed");
		assert.equal(reviewCalls, 0);
	}
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

test("Bubblewrap setup failure fails the check without calling Jev", async (t) => {
	const { runReview } = await import("../src/application/review.ts");
	const { createCliGit } = await import("../src/git/cli.ts");
	const { nodeProcess } = await import("../src/shared/process.ts");
	const { repo } = fixture(t);
	let reviewCalls = 0;
	const result = await runReview(
		{
			git: createCliGit(nodeProcess),
			checkRunner: {
				run: () => ({
					status: null,
					signal: null,
					stdout: Buffer.alloc(0),
					stderr: Buffer.alloc(0),
					error: new Error("No trusted bwrap executable found."),
					timedOut: false,
				}),
			},
			reviewClient: {
				async review() {
					reviewCalls++;
					return { model: "unused", findings: [] };
				},
			},
			env: { TYPESAFE_API_KEY: "unused" },
		},
		{
			repo,
			config: ".assertlens.json",
			base: "HEAD",
			snapshot: false,
			dryRun: false,
			sandboxed: true,
			network: false,
			command: ["unused"],
		},
	);
	assert.equal(result.exitCode, 1);
	assert.equal(result.kind, "report");
	assert.equal(result.report.checks, "failed");
	assert.equal(result.report.review, "not_run");
	assert.match(result.report.error ?? "", /trusted bwrap/i);
	assert.equal(reviewCalls, 0);
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

test("check-only runs committed source without config or Jev", async (t) => {
	const { runCheckOnly } = await import("../src/application/review.ts");
	const { createCliGit } = await import("../src/git/cli.ts");
	const { nodeProcess } = await import("../src/shared/process.ts");
	const { repo, write } = fixture(t);
	write(".assertlens.json", "not valid JSON");
	let observed = "";
	const result = runCheckOnly(
		{
			git: createCliGit(nodeProcess),
			checkRunner: {
				run(request) {
					observed = readFileSync(join(request.cwd, "sample.ts"), "utf8");
					return {
						status: 0,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
						timedOut: false,
					};
				},
			},
			env: {},
		},
		{
			repo,
			head: "HEAD",
			sandboxed: true,
			network: false,
			command: ["unused"],
		},
	);
	assert.equal(result.exitCode, 0);
	assert.equal(observed, original);
});

test("check-only returns command failure without review", (t) => {
	const { run } = fixture(t);
	const result = run(
		"--check-only",
		"--no-sandbox",
		"--",
		process.execPath,
		"-e",
		"process.exit(7)",
	);
	assert.equal(result.status, 1, result.stderr);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /check failed/i);
	assert.doesNotMatch(result.stderr, /TYPESAFE_API_KEY/);
});

test("check-only requires a command and rejects report modes", (t) => {
	const { run } = fixture(t);
	const missing = run("--check-only");
	assert.equal(missing.status, 2, missing.stderr);
	assert.match(missing.stdout, /command/i);
	for (const args of [
		["--check-only", "--json", "--", process.execPath],
		["--check-only", "--dry-run", "--json", "--", process.execPath],
		[
			"--check-only",
			"--head",
			"HEAD",
			"--no-sandbox",
			"--json",
			"--",
			process.execPath,
		],
	]) {
		const result = run(...args);
		assert.equal(result.status, 2, result.stderr);
		assert.match(JSON.parse(result.stdout).error, /check-only|sandbox/i);
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
		{ ...config, assertions: { bad: { text: "Claim.", file: ["sample.ts"] } } },
		{ ...config, assertions: { bad: { text: "Claim.", files: [] } } },
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

test("assertion scopes and folders become separate requests", (t) => {
	const { repo, git, write, run } = fixture(t);
	mkdirSync(join(repo, "lib/nested"), { recursive: true });
	write("lib/kept.ts", "kept\n");
	write("lib/removed.ts", "removed\n");
	write("lib/nested/deep.ts", "deep\n");
	write(".gitignore", "lib/ignored.ts\n");
	git("add", "lib", ".gitignore");
	git("commit", "-qm", "Add lib");
	rmSync(join(repo, "lib/removed.ts"));
	write("lib/added.ts", "added\n");
	write("lib/ignored.ts", "ignored\n");
	write(
		".assertlens.json",
		JSON.stringify({
			files: ["sample.ts"],
			assertions: {
				age_boundary: config.assertions.age_boundary,
				lib_values: { text: "Each lib file names itself.", files: ["lib/"] },
				lib_nested: { text: "Nested files are lowercase.", files: ["lib/"] },
			},
		}),
	);
	const result = run("--dry-run");
	assert.equal(result.status, 0, result.stderr);
	const requests = JSON.parse(result.stdout);
	assert.deepEqual(
		requests.map((request: { questions: object }) => Object.keys(request.questions)),
		[["age_boundary"], ["lib_values", "lib_nested"]],
	);
	assert.deepEqual(requests[1].state.files, [
		{ path: "lib/added.ts", before: null, after: "added\n" },
		{ path: "lib/kept.ts", before: "kept\n", after: "kept\n" },
		{ path: "lib/nested/deep.ts", before: "deep\n", after: "deep\n" },
		{ path: "lib/removed.ts", before: "removed\n", after: null },
	]);
});

test("committed folders compare base and head trees, not local files", (t) => {
	const { repo, git, write, run } = fixture(t);
	mkdirSync(join(repo, "lib"));
	write("lib/old.ts", "old\n");
	git("add", "lib");
	git("commit", "-qm", "Add old module");
	write("lib/new.ts", "new\n");
	git("rm", "-q", "lib/old.ts");
	git("add", "lib");
	git("commit", "-qm", "Replace module");
	write("lib/dirty.ts", "dirty\n");
	write(".assertlens.json", JSON.stringify({ ...config, files: ["lib/"] }));
	const result = run("--base", "HEAD~1", "--head", "HEAD", "--dry-run");
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout)[0].state.files, [
		{ path: "lib/new.ts", before: null, after: "new\n" },
		{ path: "lib/old.ts", before: "old\n", after: null },
	]);
});

test("folder scopes fail closed on unsafe, empty, or oversized selections", (t) => {
	const { repo, write, run } = fixture(t);
	mkdirSync(join(repo, "lib"));
	write("lib/.env", "TOKEN=x\n");
	mkdirSync(join(repo, "many"));
	for (let index = 0; index <= 50; index++) write(`many/${index}.ts`, "x\n");
	for (const [files, error] of [
		[["lib/"], /Sensitive/],
		[["empty/"], /no Git-visible files/],
		[["many/"], /more than 50 files/],
		[["../lib/"], /literal relative/],
		[["/"], /literal relative/],
		[["secrets/"], /Sensitive/],
	] as const) {
		write(".assertlens.json", JSON.stringify({ ...config, files }));
		const result = run("--json", "--dry-run");
		assert.equal(result.status, 2, result.stderr);
		assert.match(JSON.parse(result.stdout).error, error);
	}
	write(".assertlens.json", JSON.stringify({ assertions: config.assertions }));
	assert.match(JSON.parse(run("--json", "--dry-run").stdout).error, /needs files/);
});

test("only changed scopes are reviewed, and findings keep configuration order", async (t) => {
	const { runReview } = await import("../src/application/review.ts");
	const { createCliGit } = await import("../src/git/cli.ts");
	const { nodeProcess } = await import("../src/shared/process.ts");
	const { renderReport } = await import("../src/report/report.ts");
	const { git, repo, write } = fixture(t);
	write("other.ts", "other\n");
	write("third.ts", "third\n");
	git("add", "other.ts", "third.ts");
	git("commit", "-qm", "Add other modules");
	write(
		".assertlens.json",
		JSON.stringify({
			files: ["sample.ts"],
			assertions: {
				other_claim: { text: "Other is stable.", files: ["other.ts"] },
				age_boundary: config.assertions.age_boundary,
				pair_claim: { text: "Both agree.", files: ["sample.ts", "third.ts"] },
				third_claim: "Sample exports eligible.",
			},
		}),
	);
	const finding = (id: string) => ({
		id,
		choice: "supported" as const,
		verdict: "supported" as const,
		confidence: 0.9,
		probabilities: { supported: 0.9, contradicted: 0.05, insufficient: 0.05 },
	});
	const batches: string[][] = [];
	const run = (fail = false) =>
		runReview(
			{
				git: createCliGit(nodeProcess),
				checkRunner: { run: () => assert.fail("no command") },
				reviewClient: {
					async review(request) {
						const ids = Object.keys(request.questions);
						batches.push(ids);
						if (fail && batches.length === 2) throw new Error("Jev down.");
						return { model: "jev-1.13.0", findings: ids.map(finding) };
					},
				},
				env: { TYPESAFE_API_KEY: "test-only-token" },
			},
			{
				repo,
				config: ".assertlens.json",
				base: "HEAD",
				snapshot: false,
				dryRun: false,
				sandboxed: false,
				network: false,
			},
		);
	const result = await run();
	assert.ok(result.kind === "report");
	assert.equal(result.exitCode, 0);
	assert.deepEqual(batches, [["age_boundary", "third_claim"], ["pair_claim"]]);
	assert.deepEqual(result.report.unchanged, ["other_claim"]);
	assert.deepEqual(
		result.report.findings.map((item) => item.id),
		["age_boundary", "pair_claim", "third_claim"],
	);
	const markdown = renderReport(result.report);
	assert.match(markdown, /Unchanged, not reviewed: other\\_claim/);
	assert.match(markdown, /Files: sample\.ts, third\.ts/);

	batches.length = 0;
	const failed = await run(true);
	assert.ok(failed.kind === "report");
	assert.equal(failed.exitCode, 2);
	assert.equal(failed.report.review, "unavailable");
	assert.deepEqual(failed.report.findings, []);
	assert.equal(batches.length, 2);
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
	assert.match(
		report,
		/Leans contradicted, but confidence 0\.70 is below the 0\.80 advisory threshold/,
	);
});

test("Markdown explains each verdict and summarizes counts", async () => {
	const { renderReport } = await import("../src/assertlens.ts");
	const finding = (
		id: string,
		choice: "supported" | "contradicted" | "insufficient",
		verdict: "supported" | "contradicted" | "needs_review",
	) => ({
		id,
		choice,
		verdict,
		confidence: 0.9,
		probabilities: {
			supported: choice === "supported" ? 0.9 : 0.05,
			contradicted: choice === "contradicted" ? 0.9 : 0.05,
			insufficient: choice === "insufficient" ? 0.9 : 0.05,
		},
	});
	const report = renderReport({
		mode: "advisory",
		checks: "passed",
		review: "complete",
		assertions: { kept: "Users under 18 are *rejected*." },
		findings: [
			finding("kept", "supported", "supported"),
			finding("broken", "contradicted", "contradicted"),
			finding("unclear", "insufficient", "needs_review"),
		],
	});
	assert.match(
		report,
		/Review: \*\*complete\*\* \(1 contradicted, 1 needs_review, 1 supported\)/,
	);
	assert.match(report, /> Users under 18 are \\\*rejected\\\*\./);
	assert.match(report, /supports this assertion \(confidence 0\.90\)/);
	assert.match(report, /contains a counterexample \(confidence 0\.90\)/);
	assert.match(report, /Not enough evidence .*Add missing dependencies/);
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

test("requests must fit the model's token budget", async (t) => {
	const { makeRequest, review } = await import("../src/assertlens.ts");
	const state = (bytes: number) => ({
		base: "base",
		head: "working-tree",
		checks: "not_run" as const,
		files: [{ path: "sample.ts", before: null, after: "x".repeat(bytes) }],
	});
	assert.ok(makeRequest(config, state(90_000)));
	for (const model of ["jev-1.13.0", "jev-latest"])
		assert.throws(
			() => makeRequest({ ...config, model }, state(96_000)),
			/^Error: Scope "age_boundary" needs ~32\.\dk of 32k tokens \(state ~32k \+ longest question ~0\.\dk\)\. Narrow its files or split the assertion\.$/,
		);
	const assertions = (count: number, length: number) =>
		Object.fromEntries(
			Array.from({ length: count }, (_, index) => [
				`claim_${index}`,
				"y".repeat(length),
			]),
		);
	assert.ok(makeRequest({ ...config, assertions: assertions(20, 1_000) }, state(70_000)));
	assert.throws(
		() => makeRequest({ ...config, assertions: assertions(20, 6_000) }, state(80_000)),
		/needs ~\d+(\.\d)?k of 64k tokens across all questions/,
	);
	const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
	await assert.rejects(
		review({ ...makeRequest(config, state(10)), state: state(96_000) }, "test-only-token"),
		/of 32k tokens/,
	);
	assert.equal(fetch.mock.callCount(), 0);
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
	const { cliGit } = await import("../src/git/cli.ts");
	const { makeRequest } = await import("../src/jev/request.ts");
	const { repo } = fixture(t);
	const root = cliGit.repositoryRoot(repo);
	const settings = loadConfig(join(root, ".assertlens.json"));
	const state = cliGit.collectState(root, settings, "HEAD");
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

test("self-review scopes cover every runtime module within the token budget", (t) => {
	const { repo, git, write, run } = fixture(t);
	cpSync(new URL("../src/", import.meta.url), join(repo, "src"), {
		recursive: true,
	});
	write(
		".assertlens.json",
		readFileSync(new URL("../.assertlens.json", import.meta.url), "utf8"),
	);
	git("add", ".");
	git("commit", "-qm", "Add self-review source");
	const result = run("--snapshot", "--dry-run", "--json");
	assert.equal(result.status, 0, result.stdout || result.stderr);
	const requests: { state: { files: { path: string }[] } }[] = JSON.parse(
		result.stdout,
	);
	assert.ok(requests.length > 1);
	const modules = readdirSync(new URL("../src/", import.meta.url), {
		encoding: "utf8",
		recursive: true,
	})
		.filter((path) => path.endsWith(".ts"))
		.map((path) => `src/${path}`);
	const reviewed = new Set(
		requests.flatMap((request) => request.state.files.map((file) => file.path)),
	);
	assert.deepEqual([...reviewed].sort(), modules.sort());
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
	for (const option of ["--check-only", "--sandbox-network", "--no-sandbox"])
		assert.match(help.stdout, new RegExp(option));
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

test("documentation describes sandbox behavior and residual limits", () => {
	const read = (path: string) =>
		readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
	const readme = read("README.md");
	const installation = read("website/docs/installation.md");
	const cli = read("website/docs/cli-usage.md");
	const security = read("website/docs/security-and-limits.md");
	const github = read("website/docs/github-actions.md");
	for (const text of [readme, installation, cli, security]) {
		assert.match(text, /Bubblewrap/);
		assert.match(text, /Git-visible/i);
	}
	for (const option of ["--check-only", "--sandbox-network", "--no-sandbox"])
		assert.match(`${readme}\n${cli}`, new RegExp(option));
	assert.match(security, /network.*disabled by default/is);
	assert.match(security, /memory.*disk.*(?:fork|process).*denial.of.service/is);
	assert.match(
		`${readme}\n${cli}\n${security}`,
		/all tracked files.*untracked files.*(?:not ignored|ignore rules)/is,
	);
	for (const root of [
		"/usr",
		"/bin",
		"/sbin",
		"/lib",
		"/lib64",
		"/nix/store",
		"/run/current-system/sw",
		"/opt",
	])
		assert.ok(security.includes(`\`${root}\``), `missing runtime root ${root}`);
	assert.match(security, /Git path.*UTF-8|UTF-8.*Git path/i);
	assert.match(readme, /32k tokens for state\s+plus the longest question/i);
	assert.match(
		readme,
		/64,000-byte\s+cap remains for configuration, responses, and individual source reads/i,
	);
	assert.match(
		security,
		/Request token budget \| Model context: jev-1\.13 allows 32k tokens/,
	);
	assert.match(
		security,
		/Configuration, response, and individual source reads \| 64,000 bytes each/,
	);
	assert.match(github, /trusted base/i);
	assert.match(github, /sandbox/i);
	assert.doesNotMatch(
		`${readme}\n${installation}\n${cli}\n${security}`,
		/local checks are not sandboxed|--head[^\n]*refuses commands/i,
	);
});
