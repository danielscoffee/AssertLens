---
title: GitHub Actions
description: Keep executable CI separate from advisory, secret-bearing Jev review.
---

The repository includes two workflows with separate responsibilities.

| Workflow | Responsibility |
| --- | --- |
| `CI` (`.github/workflows/ci.yml`) | Use trusted base tooling to typecheck and test an immutable PR tree in Bubblewrap; also run on pushes to `main`. |
| `Jev advisory review` (`.github/workflows/jev-review.yml`) | Run sandboxed tests, then review committed PR source with trusted base policy and a narrowly scoped TypeSafe key. |

## Executable CI

For pull requests, `CI` checks out the trusted base SHA without persisting checkout
credentials. It fetches the event's PR head as Git objects using `github.token` only
through step-scoped temporary Git configuration, then verifies the immutable SHA.
The workflow installs Bubblewrap, runs trusted base integration smoke tests, and
installs trusted TypeScript and Node type packages from base-branch versions. It then
invokes:

```bash
node src/assertlens.ts --head "$CHECK_HEAD_SHA" --check-only -- tsc --noEmit --typeRoots "$TYPE_ROOTS"
node src/assertlens.ts --head "$CHECK_HEAD_SHA" --check-only -- npm test
```

Both commands run against a disposable Git-visible tree with network disabled.
Repository secrets are not provided, PR source is never checked out on the host,
and PR dependencies are not installed. On Ubuntu 24.04's disposable hosted runner,
the setup step permits unprivileged user namespaces and preflights Bubblewrap.

Use **`CI / check`** as the required branch-protection check, not the advisory job.
The workflow checks the root CLI package; it does not build this documentation site.
Run the docs build locally from `website/`.

## Advisory review

The review workflow uses the ordinary `pull_request` event and skips draft PRs.
It:

1. Checks out the trusted base SHA, including the CLI and `.assertlens.json` policy.
2. Fetches PR commits as Git objects without checking them out.
3. Confirms the fetched SHA still matches the PR event; a moving PR is rejected.
4. Removes the read-only checkout credential and preflights Bubblewrap.
5. Runs `npm test` against the exact PR tree inside the sandbox.
6. Sends the configured source scope to Jev from the trusted parent process and
   writes the report to the job summary.

The final step alone receives `TYPESAFE_API_KEY`. Bubblewrap clears the command
environment, hides the host checkout, and disables network, so PR tests cannot read
the key. The workflow never installs PR dependencies, consumes PR artifacts,
restores caches, persists fetch credentials, or checks out PR source on the host.

The job records its own sandboxed check result. Separate CI results are not imported
or trusted as model evidence. A missing key or service failure fails the advisory
job visibly; a completed review with contradictions remains advisory.

## Enable review

1. Confirm your repository's data-sharing policy permits sending configured source
   files to TypeSafe.
2. Add the Actions repository secret `TYPESAFE_API_KEY`.
3. Put the trusted CLI, workflow, and reviewed `.assertlens.json` on your base branch.

AssertLens does not configure your repository remotely. API calls consume your TypeSafe quota;
manage contributor access and account budgets accordingly.

## Forks and Dependabot

Same-repository PRs can use the Actions secret. Fork and Dependabot PRs normally
cannot: GitHub withholds secrets for ordinary PR events. Their Jev review is
unavailable, not approved. Review these commits with trusted local tooling and
`--head` when appropriate.

:::danger Preserve the secret boundary
Do not enable secret sharing with forks or switch to a privileged event to bypass
GitHub's protections. Workflow definitions can themselves be edited in
same-repository PRs. Restrict contributor access and review changes to
`.github/workflows/` carefully.
:::

Changes only outside configured files make review `not_run` (exit `3`). The workflow
and the reusable action report it as a notice rather than a failure; it is not a claim
that the entire PR was checked. Missing keys and service failures still fail.

## Adopt in another TypeScript repository

Copy the trusted CLI modules and workflows, then write your own `.assertlens.json`.
Adjust the workflow's entry path if you relocate the CLI. Keep the target repository's
normal CI and provision required compilers/test tools from trusted base policy.
Git-visible workspaces omit untracked ignored dependency directories. Tracked files
are always staged even when an ignore rule also matches them.

The CLI itself has no runtime npm dependencies. Do not install PR dependencies on
the host or expose credentials/network to untrusted checks. Execute PR code only
through the trusted Bubblewrap runner.

## Sandboxed checks without a key

`check-only` runs a command in Bubblewrap without configuration, credentials, or a
review provider. It suits pull-request tests you do not trust: the command sees a
disposable copy of the committed tree, no network by default, no service tokens, and
no host home or `.git`.

```yaml
- uses: actions/checkout@v6
  with:
    persist-credentials: false
- uses: danielscoffee/AssertLens@v0.1.0
  with:
    head: HEAD
    check-only: "true"
    command: '["npm", "test"]'
```

Projects that need dependencies can install them inside the sandbox with network
enabled for that command only: `command: '["sh", "-c", "npm ci --ignore-scripts && npm test"]'`
and `sandbox-network: "true"`. The sandbox does not cap memory, disk, or processes.

## Reusable action

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

## Container image

The `Image` workflow publishes `ghcr.io/danielscoffee/assertlens` from `main`
(`main`, `sha-<commit>`); [releases](#releases) add semver tags. Pin by digest.
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
