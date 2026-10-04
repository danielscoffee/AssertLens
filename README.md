# AssertLens

Run local correctness checks and advisory GitHub pull-request reviews with AssertLens.
Node 24.12+ runs the TypeScript source directly; the npm package ships compiled JavaScript.
No runtime dependencies or server.

**Executable checks test behavior. Jev judges explicit assertions against selected
source. Neither passing tests nor model confidence proves general correctness.**

## Quick start

As a GitHub Action, on a trusted-base checkout (see [GitHub pull requests](#github-pull-requests)):

```yaml
- uses: danielscoffee/AssertLens@v0.1.0
  with:
    base: ${{ github.event.pull_request.base.sha }}
    head: ${{ github.event.pull_request.head.sha }}
    command: '["npm", "test"]'
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

Or from npm (`npm install --global assertlens`) or the container image
`ghcr.io/danielscoffee/assertlens`.

## Documentation

Guides live in [`website/docs/`](website/docs/intro.md) and are published at
<https://danielscoffee.github.io/AssertLens/>. Run the isolated Docusaurus site
locally:

```bash
npm ci --prefix website --ignore-scripts
npm run --prefix website start
```

See [`website/README.md`](website/README.md) for build and preview commands.
The CLI does not depend on the documentation site's packages.

## Install

```bash
npm install --global assertlens
assertlens --help
```

The package contains compiled JavaScript because Node does not strip TypeScript types
inside `node_modules`. The examples below run the source checkout with
`node src/assertlens.ts`; an installed `assertlens` accepts the same options.

## Local usage

Requirements: Node 24.12+ and Git. Default command execution also requires Linux with Bubblewrap (`bwrap`). Development checks need the locked dev dependencies:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
```

Review requires an existing Git commit. By default, at least one selected file must
differ from the base; otherwise review is `not_run` and the CLI exits `3`. Use `--snapshot` to review selected source even with a clean
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
creates a writable disposable workspace containing Git-visible files: all tracked
files, even when ignore rules match, plus untracked files that are not ignored. For
`--head`, it uses the exact committed tree. It omits `.git` and untracked ignored
files such as host dependencies. Use `--sandbox-network` only when required.

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

An assertion can instead name its own files. A trailing `/` selects a folder:

```json
{
  "files": ["src/auth.ts"],
  "assertions": {
    "expiry": "Expired tokens are rejected before protected data is returned.",
    "routes": {
      "text": "Every route handler calls requireSession before reading user data.",
      "files": ["src/routes/", "src/auth.ts"]
    }
  }
}
```

These are semantic review claims, not executable tests. Keep actual assertions in
your test suite. Prefer narrow, falsifiable claims to “this code is correct.”

- Select 1–20 literal, repository-relative files or folders per list and 1–20 named
  assertions. Top-level `files` is required only for string assertions.
- Folders expand recursively to Git-visible files: tracked plus untracked files that
  are not ignored locally, or the base and head trees with `--head`. Each expanded
  file passes the same path, sensitive-path, and file-type checks; one failure makes
  the review unavailable. A scope may expand to at most 50 files.
- Assertions with the same files share one request; each distinct scope is a separate
  request and API call. Without `--snapshot`, scopes whose files are all unchanged are
  skipped and reported as unchanged.
- Include relevant unchanged dependencies/tests explicitly; they are not discovered.
- Jev receives full **before/after contents** of those files, commit identifiers,
  check status, and your assertion text. Check logs and credentials are not sent.
- `--head` reads committed source and compares against the merge base. Local mode
  compares selected working files directly against `--base`.
- Regular UTF-8 files only: no symlinks, binaries, traversal, globs, or submodules.
- Secret-like paths are rejected as an accident guard, **not a secret scanner**.
  Do not select files containing credentials or personal data. Inspect dry-run output
  before sending private code; avoid saving sensitive payloads in shared logs.
- Each request must fit its model's token budget: `jev-1.13` allows 32k tokens for state
  plus the longest question and 64k tokens for state plus all questions. Tokens are
  estimated conservatively as bytes ÷ 3; aliases and unknown models use the `jev-1.13`
  budget. An oversized scope fails before sending, with its estimated tokens. A 64,000-byte
  cap remains for configuration, responses, and individual source reads. Oversized
  input fails instead of silently dropping context; server context-limit errors also
  make review unavailable.

For each assertion, Jev chooses `supported`, `contradicted`, or `insufficient`.
Insufficient evidence and confidence below 0.8 become `needs_review`. Reports retain
raw choice, confidence, and all three probabilities. Markdown reports add a fixed
plain-language explanation and next step derived from those values; Jev returns no
rationale, and no other model writes one. The threshold is an
**uncalibrated advisory starting point**. There is no model-based merge-blocking mode.

Missing keys, malformed/missing answers, invalid probabilities, network failures,
and a changed source snapshot during checks cannot produce a completed review.
Requests have a 30-second timeout and are not automatically retried.

| Exit | Meaning |
| --- | --- |
| `0` | Advisory review completed, or help/dry-run completed. **Not approval.** |
| `1` | Executable check failed, timed out, or could not start. Jev was not called. |
| `2` | Invalid input or unavailable/incomplete review. |
| `3` | No selected file changed, so review is `not_run`. Any command still ran and passed. **Not approval.** |

## GitHub pull requests

Two workflows keep execution and secret-bearing review separate:

- **`CI`** checks out trusted base tooling without persisting credentials, fetches the
  immutable PR commit using step-scoped temporary Git configuration, then runs
  typecheck and tests against a disposable Git-visible tree through Bubblewrap. No
  repository secrets are provided.
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
Changes only outside configured files make review `not_run` (exit `3`), which the
workflow reports as a notice, not a claim that the whole PR was checked. The supplied workflow reads policy/tooling from the
base branch. Workflow definitions themselves can be edited in same-repository PRs;
restrict contributor access and review `.github/workflows/` changes carefully.

To adopt this in another TypeScript repository, copy the trusted CLI modules, review
workflow, and your own `.assertlens.json`; adjust the workflow's entry path if needed.
Keep that repository's normal CI. The CLI has no runtime npm dependencies, but
sandboxed commands require Linux and Bubblewrap.

Or use the reusable composite action, which runs the CLI from the action's own pinned
checkout. Pin it to a full commit SHA, or to a release tag such as `v0.1.0`. Its command is a JSON array run without a shell
in Bubblewrap, and the report is also appended to the job summary:

```yaml
- uses: danielscoffee/AssertLens@<commit-sha>
  with:
    base: ${{ github.event.pull_request.base.sha }}
    head: ${{ github.event.pull_request.head.sha }}
    command: '["npm", "test"]'
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

Inputs: `repo`, `config`, `base`, `head`, `command`, `snapshot`, `check-only`, and
`sandbox-network`. The action sets up Node 24 and, when a command is given, installs
Bubblewrap on the Linux runner. It exits with the CLI's exit code. The action runs
wherever your workflow checked out code, so keep the trusted-base checkout pattern
from the supplied workflows.

### Container image

The `Image` workflow publishes `ghcr.io/danielscoffee/assertlens` from `main`
(`main`, `sha-<commit>`); releases add semver tags. Pin by digest.
The image contains the CLI, Git, and Bubblewrap, and runs as a non-root user.
Sandboxed checks inside the container need relaxed container confinement so
Bubblewrap can create its own namespaces:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo" -e TYPESAFE_API_KEY \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined \
  ghcr.io/danielscoffee/assertlens@sha256:<digest> --snapshot -- npm test
```

Without those options the sandbox cannot start and checks fail closed. `--user` must
own the mounted repository or Git rejects it; with rootless Docker, use `--user 0:0`,
which maps to your unprivileged host user. Review-only and `--dry-run` runs need no
extra options.

## Releases

Releases are driven by semver tags. Bump `version` in `package.json` on `main`, then
push a matching tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The `Release` workflow checks that the tag is `vMAJOR.MINOR.PATCH[-PRERELEASE]`,
matches `package.json`, and points to a commit on `main`. It then typechecks, tests,
and builds before deploying:

| Channel | Stable `v1.2.3` | Prerelease `v1.3.0-rc.1` |
| --- | --- | --- |
| npm `assertlens` | dist-tag `latest` | dist-tag `next` |
| GHCR image | `1.2.3`, `1.2`, `1`, `latest` | `1.3.0-rc.1` |
| GitHub release | Draft with generated notes | Draft prerelease |

npm and GHCR deploy through the `npm` and `ghcr` GitHub environments, so each deploy
appears under the repository's deployments. npm uses trusted publishing (OIDC) with
provenance; no npm token is stored. Floating image tags assume versions are released
in increasing order.

GitHub Marketplace listing is only possible in the web UI, so the workflow leaves a
draft release. Open it, check **Publish this Action to the GitHub Marketplace**, pick
a category, and publish. The first listing requires accepting the Marketplace
Developer Agreement, and publishing requires two-factor authentication. A version
already on npm and an existing release are skipped, so reruns and manually
drafted releases are safe.

One-time setup: publish the first version manually with `npm publish --access public`
from a clean checkout of `main`. Then add a trusted publisher on npmjs.com with user
`danielscoffee`, repository `AssertLens`, workflow `release.yml`, and environment
`npm`. Later versions publish automatically; the already published version is skipped. Consider a tag ruleset limiting
who can push `v*` tags, and required reviewers on both environments.

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
