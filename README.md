# AssertLens

Run local correctness checks and advisory GitHub pull-request reviews with AssertLens.
Node 24.12+ runs the TypeScript source directly. No runtime dependencies, server, or build step.

**Executable checks test behavior. Jev judges explicit assertions against selected
source. Neither passing tests nor model confidence proves general correctness.**

## Documentation

Guides live in [`website/docs/`](website/docs/intro.md). Run the isolated Docusaurus
site locally:

```bash
npm ci --prefix website --ignore-scripts
npm run --prefix website start
```

See [`website/README.md`](website/README.md) for build and preview commands.
The CLI does not depend on the documentation site's packages.

## Local usage

Requirements: Node 24.12+ and Git. Default command execution also requires Linux with Bubblewrap (`bwrap`). Development checks need the locked dev dependencies:

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
node src/assertlens.ts --snapshot --dry-run
```

Set `TYPESAFE_API_KEY` through your secret manager or shell environment; do not put
credentials in configuration or source. The CLI does not load `.env` files.

```bash
# Review selected source even with no changes; run the check in Bubblewrap.
node src/assertlens.ts --snapshot -- npm test

# Review selected working-tree files against HEAD, including untracked files.
node src/assertlens.ts --base HEAD

# Check an immutable commit tree before reviewing it.
node src/assertlens.ts --base origin/main --head HEAD -- npm test

# Run only the sandboxed check, without configuration, credentials, or Jev.
node src/assertlens.ts --head HEAD --check-only -- npm test

# Explicitly run a trusted local command without isolation.
node src/assertlens.ts --no-sandbox -- npm test

# Review another repository; configuration is relative to that repository's root.
node src/assertlens.ts --repo /path/to/project --base origin/main --dry-run
```

`--` separates the executable command and arguments. By default, commands run without
a shell inside Bubblewrap, with a two-minute timeout and network disabled. AssertLens
creates a writable disposable workspace containing Git-visible files: tracked plus
unignored working files locally, or the exact committed tree for `--head`. It omits
`.git`, ignored files, and host dependencies. Use `--sandbox-network` only when a
check explicitly needs network access.

Check output goes to stderr; stdout contains one Markdown or JSON report. No command
means `checks: not_run`, not passed. `--dry-run` refuses commands. `--no-sandbox`
runs in the original local repository, prints a warning, and is incompatible with
`--head`; use it only for trusted code.

Bubblewrap isolates mounted files, environment, processes, and network by default.
It does not impose memory, disk, or process-count quotas, so untrusted code can still
cause denial of service before the timeout. Use trusted CLI and configuration from
the base branch when reviewing another repository.

## Assertions and scope

Edit `.assertlens.json` to name the exact files and claims you want reviewed:

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
- Serialized review state and requests are capped at 96,000 bytes. A 64,000-byte
  cap remains for configuration, responses, and individual source reads. Oversized
  input fails instead of silently dropping context. These byte limits are not token
  estimates; server context-limit errors also make review unavailable.

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

- **`CI`** checks out trusted base tooling, fetches the immutable PR commit as Git
  data, removes checkout credentials, then runs typecheck and tests against a
  disposable Git-visible tree through Bubblewrap. No repository secrets are provided.
- **`Jev advisory review`** follows the same trusted-base fetch boundary, runs
  `npm test` inside Bubblewrap, and only then asks Jev from the trusted parent process.
  The TypeSafe key is scoped to that final step and never enters the sandbox. Neither
  workflow checks PR source out on the host, consumes PR artifacts, or restores caches.

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
job records its own sandboxed `npm test` result; separate CI results are not imported
or trusted as model evidence. Missing key/service failure makes the advisory job fail
visibly; a completed review with contradictions remains advisory. Draft PRs are skipped.
Changes only outside configured files produce an unavailable review, not a claim
that the whole PR was checked. The supplied workflow reads policy/tooling from the
base branch. Workflow definitions themselves can be edited in same-repository PRs;
restrict contributor access and review `.github/workflows/` changes carefully.

To adopt this in another TypeScript repository, copy the trusted CLI modules, review
workflow, and your own `.assertlens.json`; adjust the workflow's entry path if needed.
Keep that repository's normal CI. The CLI has no runtime npm dependencies, but
sandboxed commands require Linux and Bubblewrap.

## Modules

| File | Responsibility |
| --- | --- |
| `src/assertlens.ts` | CLI parsing and adapter composition |
| `src/application/` | Review and check-only orchestration |
| `src/check/` | Check-runner port and explicit direct adapter |
| `src/config/` | Configuration parsing and validation |
| `src/git/` | Git adapter, bounded review state, and disposable workspaces |
| `src/jev/` | Request construction, HTTP adapter, and answer validation |
| `src/report/` | Report types and Markdown rendering |
| `src/sandbox/` | Bubblewrap adapter and isolation policy |
| `src/shared/` | Shared process adapter, size limits, and guards |

Types live with the modules that own them. The `src/assertlens.ts` entry point
exports `makeRequest`, `review`, and `renderReport`. The self-review configuration
selects every runtime module.

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
