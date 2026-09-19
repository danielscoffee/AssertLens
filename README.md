# qg-jev

Local correctness checks and advisory GitHub PR review, written in TypeScript.
Node 24.12+ runs the source directly. No runtime dependencies, server, or build step.

**Executable checks test behavior. Jev judges explicit assertions against selected
source. Neither passing tests nor model confidence proves general correctness.**

## Local usage

Requirements: Node 24.12+ and Git. Development checks need the locked dev dependencies:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
```

Review requires an existing Git commit. By default, at least one selected file must
differ from the base. Use `--snapshot` to review selected source even with a clean
working tree; it still includes full before/after contents against the chosen base.

Inspect the exact outbound payload without credentials or network access:

```bash
node src/qg-jev.ts --snapshot --dry-run
```

Set `TYPESAFE_API_KEY` through your secret manager or shell environment; do not put
credentials in configuration or source. The CLI does not load `.env` files.

```bash
# Review selected source even with no changes; run checks before calling Jev.
node src/qg-jev.ts --snapshot -- npm test

# Review current selected files against HEAD, including staged/unstaged/untracked files.
node src/qg-jev.ts --base HEAD

# Run a trusted local check first. Failure exits 1 without calling Jev.
node src/qg-jev.ts --base HEAD -- npm test

# Review another repository; configuration is relative to that repository's root.
node src/qg-jev.ts --repo /path/to/project --base origin/main --dry-run

# Review committed branch changes against their merge base; do not execute PR code.
node src/qg-jev.ts --base origin/main --head HEAD --json
```

`--` separates the executable command and arguments. Commands run directly, not
through a shell, with a two-minute timeout. Check output goes to stderr; stdout
contains one Markdown or JSON report. No command means `checks: not_run`, not passed.
`--head` and `--dry-run` refuse commands.

Local commands must be trusted. Removing service tokens from their environment is
not a sandbox; local code can still access your machine. For untrusted PRs, use
`--head` to inspect Git objects without checking out or running their contents.
Use a trusted CLI and trusted configuration when reviewing another repository.

## Assertions and scope

Edit `.qg-jev.json` to name the exact files and claims you want reviewed:

```json
{
  "model": "jev-1.13.0",
  "files": ["src/auth.ts", "test/auth.test.ts"],
  "assertions": {
    "expiry": "Expired tokens are rejected before protected data is returned.",
    "expiry_test": "A test asserts rejection of an expired token."
  }
}
```

These are semantic review claims, not executable tests. Keep actual assertions in
your test suite. Prefer narrow, falsifiable claims to “this code is correct.”

- Select 1–20 literal, repository-relative paths and 1–20 named assertions.
- Include relevant unchanged dependencies/tests explicitly; they are not discovered.
- Jev receives full **before/after contents** of those files, commit identifiers,
  check status, and your assertion text. Check logs and credentials are not sent.
- `--head` reads committed source and compares against the merge base. Local mode
  compares selected working files directly against `--base`.
- Regular UTF-8 files only: no symlinks, binaries, traversal, globs, or submodules.
- Secret-like paths are rejected as an accident guard, **not a secret scanner**.
  Do not select files containing credentials or personal data. Inspect dry-run output
  before sending private code; avoid saving sensitive payloads in shared logs.
- State, request, response, and individual source reads are capped at 64,000 bytes.
  Oversized input fails instead of silently dropping context. This byte limit is
  not a token estimate; server context-limit errors also make review unavailable.

For each assertion, Jev chooses `supported`, `contradicted`, or `insufficient`.
Insufficient evidence and confidence below 0.8 become `needs_review`. Reports retain
raw choice, confidence, and all three probabilities. The threshold is an
**uncalibrated advisory starting point**. There is no model-based merge-blocking mode.

Missing keys, malformed/missing answers, invalid probabilities, network failures,
and a changed source snapshot during checks cannot produce a completed review.
Requests have a 30-second timeout and are not automatically retried.

| Exit | Meaning |
| --- | --- |
| `0` | Advisory review completed, or help/dry-run completed. **Not approval.** |
| `1` | Executable check failed, timed out, or could not start. Jev was not called. |
| `2` | Invalid input or unavailable/incomplete review, including unchanged scope without `--snapshot`. |

## GitHub pull requests

Two workflows keep execution and secret-bearing review separate:

- **`CI`** checks the PR merge checkout with `npm run typecheck` and `npm test`.
  No repository secrets are provided; checkout credentials are not retained.
- **`Jev advisory review`** uses `pull_request`, checks out the trusted base
  SHA, and fetches PR commits **as data only**. The CLI and policy come from the base
  commit. It never checks out PR source, installs PR dependencies, runs PR tests,
  consumes PR artifacts, or restores caches. Results appear in the job summary.

Add repository Actions secret `TYPESAFE_API_KEY`, then put these files on your trusted
base branch to enable review. This sends the configured source scope to TypeSafe;
confirm your repository's data-sharing policy first. No remote setup is performed
by this project.

Same-repository PRs can use the Actions secret. Fork and Dependabot PRs normally
cannot: GitHub withholds secrets for ordinary PR events. Their Jev review is
unavailable, not approved; use the trusted local CLI with `--head` for these PRs.
Do not enable secret sharing with forks or switch to a privileged event to bypass
that boundary. API calls consume your TypeSafe quota; manage repository access and
account budgets accordingly. A PR that moves during fetching is rejected rather
than reviewed at the wrong SHA.

Use **`CI / check`** for required branch protection, not the advisory job. The review
job records `checks: not_run`: separate CI results are not imported or trusted as
model evidence. Missing key/service failure makes the advisory job fail visibly;
a completed review with contradictions remains advisory. Draft PRs are skipped.
Changes only outside configured files produce an unavailable review, not a claim
that the whole PR was checked. The supplied workflow reads policy/tooling from the
base branch. Workflow definitions themselves can be edited in same-repository PRs;
restrict contributor access and review `.github/workflows/` changes carefully.

To adopt this in another TypeScript repository, keep all `src/*.ts` modules together,
copy the trusted review workflow and your own `.qg-jev.json`, and adjust the workflow's
entry path if relocating them. Keep that repository's normal CI. The review CLI
itself needs only Node and Git, not `npm install`.

## Modules

| File | Responsibility |
| --- | --- |
| `src/qg-jev.ts` | CLI arguments, executable checks, and orchestration |
| `src/config.ts` | Configuration parsing and validation |
| `src/git.ts` | Repository discovery and bounded source snapshots |
| `src/jev.ts` | Typed questions, HTTP requests, and answer validation |
| `src/report.ts` | Report types and Markdown rendering |
| `src/validation.ts` | Shared size limits and value guards |

Types live with the modules that own them. CLI commands and existing public exports
remain unchanged. The self-review configuration selects every runtime module.

## Validation and limits

```bash
npm run typecheck
npm test
```

Tests use real temporary Git repositories and subprocesses, plus mocked HTTP
responses for API-contract and failure handling. They do **not** measure live Jev
accuracy. Before considering model-driven blocking, evaluate representative
known-good and buggy changes and measure false positives, misses, and uncertainty.

V1 deliberately omits inline PR comments, generated fixes, automatic test generation,
repository-wide dependency discovery, deployments, and auto-merge.

API contract: <https://docs.typesafe.ai/api.md>. Model/version reference:
<https://docs.typesafe.ai/models.md>.
