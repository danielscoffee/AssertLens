# Local and GitHub PR Review Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Provide a local, dependency-free correctness-check CLI and advisory Jev review of GitHub pull requests.

**Architecture:** Executable checks determine test success; Jev independently evaluates explicit assertions against selected source files and their changes. Local execution uses the current working tree; committed PR review reads Git objects without executing PR code. No server, auto-merge, deployment, or model-based merge blocking.

**Tech Stack:** TypeScript (explicit user choice), Node.js 24.12+ native type stripping, Git, TypeSafe HTTP API, GitHub Actions, node:test. TypeScript and Node type definitions are development-only dependencies; no runtime dependencies.

---

## Approved scope and policy

- CLI first, reusable by GitHub Actions. Keep implementation parent-led in this initially empty workspace; no existing Git worktree needs isolation.
- Configuration explicitly selects relative source paths and named, natural-language assertions. Never read the entire repository automatically.
- Local review includes tracked and untracked selected files; `--base` defaults to HEAD. `--head` reviews immutable Git contents against their merge base and cannot execute a check command.
- Optional command after `--` executes directly, without a shell, only for trusted local workspaces. Nonzero command status fails the run and prevents the API call.
- `--dry-run` prints the outbound payload without checks, credentials, or an API call. Selected contents are sent to TypeSafe only on a real review.
- Each assertion is a Choice: supported, contradicted, insufficient evidence. Low-confidence answers become needs-review; this threshold is advisory and uncalibrated.
- Missing credentials, malformed answers, excessive input, and service failures are errors, never approvals. No automatic retries or fabricated findings.
- Pin Jev version; record returned model, probability distributions, and scope. Template Markdown or JSON reports; no invented explanations.
- Exit 0: completed advisory review (not proof/approval), help, or dry-run. Exit 1: executable check failed. Exit 2: unavailable/incomplete review or invalid input.
- PR tests run on `pull_request` without secrets. A separate regular `pull_request` workflow checks out trusted base code, fetches PR objects as data, and runs only trusted tooling. Read-only token, no inline comments, no caches or untrusted artifacts. Security validation led to dropping the privileged-event draft: fork/Dependabot secrets remain unavailable, so those reviews use the local CLI.

## Task 1: Tests before implementation

**Files:** `test/assertlens.test.ts`, `package.json`, `tsconfig.json`.

1. Use `node:test` with temporary Git repositories to exercise real local changes, untracked selected files, committed-head isolation, and merge-base behavior.
2. Write CLI assertions for dry-run, failed checks, missing keys, invalid config, secret-path rejection, and excessive input. First run should fail because CLI is absent.
3. Test the documented HTTP contract through a mocked fetch boundary, including incomplete answers, invalid probability distributions, and service failure. These are integration-contract tests, not model-accuracy evaluations.
4. Run `npm test`; record the expected failures before creating production code.

## Task 2: Minimal local implementation

**Files:** `src/assertlens.ts`, `.assertlens.json`, `.gitignore`, `package.json`.

1. Implement config validation and bounded, literal-path Git reads. Reject symlinks, binary input, secret-like paths, and silent truncation.
2. Construct narrow batched questions with explicit insufficient-evidence criteria. Use `POST https://api.typesafe.ai/v1/systemone`, bearer auth, timeout, and no redirects.
3. Validate every expected answer and render deterministic Markdown/JSON reports. Preserve check failure independently of model judgment.
4. Execute optional local checks without a shell; omit service tokens from the child environment and reject selected-source mutations during checks. This is not a sandbox; local code must be trusted.
5. Run `npm test` after each implementation increment until tests pass.

## Task 3: GitHub integration and documentation

**Files:** `.github/workflows/ci.yml`, `.github/workflows/jev-review.yml`, `README.md`.

1. Pin official checkout/setup-node actions to verified commits. Run `npm ci --ignore-scripts`, `npm run typecheck`, and `npm test` on PRs and default-branch pushes. Trusted review needs no package installation.
2. Use base-SHA checkout and event-provided immutable PR head SHA for trusted review. Never check out or execute PR source in the secret-bearing job. Scope API key to review step.
3. Write summaries to GitHub's job summary; explicitly distinguish missing key from completed review. Keep executable CI authoritative.
4. Document local commands, exact configuration, outbound data, exit codes, API-key setup, first-commit bootstrap, fork behavior, and limitations.

## Task 4: Validation

1. Run LSP diagnostics before final tests; report unavailable tooling honestly.
2. Run `npm run typecheck` and `npm test`.
3. Exercise CLI help and local dry-run in a disposable real Git repository.
4. Validate workflow structure and security invariants in tests; use actionlint if available.
5. Run `lens_diagnostics` mode=all and inspect Git status/diff. No push, deployment, or remote configuration changes.

## Validation results

Historical results from the initial implementation; path references use current AssertLens names.

- `npm ci --ignore-scripts`: passed; lockfile and manifest agree.
- `npm run typecheck`: passed.
- `npm test`: 20 tests passed, including real temporary Git repositories and CLI subprocesses.
- `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml .github/workflows/jev-review.yml`: passed.
- `node src/assertlens.ts --help`: passed. Local dry-run, untracked source, committed-head isolation, and fork-safe workflow invariants are covered by tests.
- Primary LSP diagnostics: clean. Final lens cache has no blocking errors but retains two warnings for the removed privileged-trigger draft; current workflow uses ordinary `pull_request`.
- Independent read-only review: no Critical/Important findings. Minor omission of raw choice from Markdown fixed and covered by a regression test.
- Live TypeSafe requests and hosted GitHub runs were not tested: no API key or remote repository configured. Source remains uncommitted; review needs an existing base commit.

## Sources checked

- <https://docs.typesafe.ai/api.md> — endpoint and typed response contract.
- <https://docs.typesafe.ai/models.md> — pinned `jev-1.13.0`, context limits, aliases.
- <https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md> — deterministic control, narrow judgments.
- <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows> — PR event trust boundaries.
- Official Git repositories: checkout v6 `d23441a48e516b6c34aea4fa41551a30e30af803`; setup-node v6 `249970729cb0ef3589644e2896645e5dc5ba9c38`.
