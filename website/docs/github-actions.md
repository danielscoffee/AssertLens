---
title: GitHub Actions
description: Keep executable CI separate from advisory, secret-bearing Jev review.
---

The repository includes two workflows with separate responsibilities.

| Workflow | Responsibility |
| --- | --- |
| `CI` (`.github/workflows/ci.yml`) | Typecheck and test the PR merge checkout; also run on pushes to `main`. |
| `Jev advisory review` (`.github/workflows/jev-review.yml`) | Review committed PR source as data using trusted base-branch tooling and policy. |

## Executable CI

`CI` installs locked dev dependencies with `npm ci --ignore-scripts`, then runs
`npm run typecheck` and `npm test`. Repository secrets are not provided, and checkout
credentials are not retained.

Use **`CI / check`** as the required branch-protection check, not the advisory job.
The existing CI checks the root CLI package; it does not build this documentation
site. The docs build can be run locally from `website/`.

## Advisory review

The review workflow uses the ordinary `pull_request` event and skips draft PRs.
It:

1. Checks out the trusted base SHA, including the CLI and `.assertlens.json` policy.
2. Fetches PR commits as Git objects without checking them out.
3. Confirms the fetched SHA still matches the PR event; a moving PR is rejected.
4. Runs the trusted CLI with `--base` and `--head` and writes its report to the
   GitHub Actions job summary.

It never installs PR dependencies, runs PR tests, consumes PR artifacts, restores
caches, or checks out PR source. A read-only checkout token is retained for the
fetch; no PR code executes in the supplied workflow.

The job reports `checks: not_run`. Separate CI results are not imported or trusted
as model evidence. A missing key or service failure fails the advisory job visibly;
a completed review with contradictions remains advisory.

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

Keep all `src/*.ts` CLI modules together, copy the trusted review workflow, and
write your own `.assertlens.json`. Adjust the workflow's entry path if you relocate the
CLI modules. Keep the target repository's normal CI.

The review CLI needs only Node and Git, not `npm install`. Do not install or execute
untrusted PR code in the secret-bearing review job.
