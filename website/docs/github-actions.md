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

For pull requests, `CI` checks out the trusted base SHA and fetches the event's PR
head as Git objects. It verifies the immutable SHA and removes checkout credentials
before any PR command runs. The workflow installs Bubblewrap and trusted TypeScript
and Node type packages from versions declared by the base branch. It then invokes:

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
restores caches, or checks out PR source on the host.

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

Changes only outside configured files produce an unavailable review, not a claim
that the entire PR was checked.

## Adopt in another TypeScript repository

Copy the trusted CLI modules and workflows, then write your own `.assertlens.json`.
Adjust the workflow's entry path if you relocate the CLI. Keep the target repository's
normal CI and provision required compilers/test tools from trusted base policy.
Git-visible workspaces intentionally omit ignored dependency directories.

The CLI itself has no runtime npm dependencies. Do not install PR dependencies on
the host or expose credentials/network to untrusted checks. Execute PR code only
through the trusted Bubblewrap runner.
