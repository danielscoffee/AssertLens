---
title: Security & limits
description: Understand source sharing, command trust boundaries, and advisory review limits.
---

## Source sharing

Live reviews send selected files' full before/after contents, commit identifiers,
check status, and assertion text to TypeSafe. Check logs and environment credentials
are not included in that payload. The API key authenticates the HTTP request.

Only select source you are permitted to share. Never select files containing
credentials or personal data. Sensitive-path rejection is an accident guard,
**not a secret scanner**: a harmless filename can still contain secrets.

Inspect the outbound payload before sending private source:

```bash
node src/assertlens.ts --snapshot --dry-run
```

Dry run requires neither credentials nor network access, but its stdout contains
source. Avoid saving sensitive payloads in shared logs.

## Credentials and command isolation

Set `TYPESAFE_API_KEY` through your secret manager or shell environment. Do not put
it in configuration or source. The CLI does not load `.env` files.

Default commands run without a shell inside Bubblewrap for at most two minutes.
AssertLens clears the child environment, provides a private home and temporary
directory, and restores only a fixed operational environment. Service tokens never
enter the sandbox.

Each command receives a writable disposable workspace containing Git-visible files:
tracked plus unignored working files locally, or the exact committed tree selected
by `--head`. The original repository, `.git`, ignored files such as `.env`, host
home, runtime sockets, and host dependency directories are not mounted. System
toolchains are mounted read-only. Network is disabled by default; the explicit
`--sandbox-network` flag shares host networking.

:::warning Resource denial remains possible
Bubblewrap isolates files, environment, process visibility, and network access, but
AssertLens sets no memory, disk, or fork/process-count quotas. Untrusted code can
still cause denial-of-service before the timeout. Run high-risk code on a disposable
host with external resource limits.
:::

`--no-sandbox` bypasses this boundary, runs in the original local repository, and
prints a warning. It removes `TYPESAFE_API_KEY`, `GITHUB_TOKEN`, and `GH_TOKEN`, but
can still read other files, credentials, and network resources. Use it only for
trusted local code; it is incompatible with `--head`.

For untrusted PR source, use trusted base tooling with `--head REF -- command`.
AssertLens reads Git objects without checking PR source out on the host, materializes
the committed tree, then executes it in Bubblewrap. The supplied
[GitHub workflows](github-actions.md) follow this boundary.

## Scope and resource limits

| Resource | Limit |
| --- | --- |
| Selected files | 1–20 unique literal repository-relative paths |
| Named assertions | 1–20 |
| Assertion text | Nonblank, at most 1,000 characters |
| Serialized review state and outbound request | 96,000 bytes each |
| Configuration, response, and individual source reads | 64,000 bytes each |
| Executable check | Two minutes |
| Jev request | 30 seconds; no automatic retries |

Regular UTF-8 source files only: no symlinks, binaries, traversal, globs, or
submodules. Oversized input fails instead of silently dropping context. These byte
limits are not token estimates; server context-limit errors also make a review
unavailable.

No dependency discovery occurs. Omitted source and tests remain outside the review
scope, even when selected files import them.

## Unavailable is not passed

Missing credentials, malformed or missing answers, invalid probabilities, network
failures, and a changed source snapshot during checks cannot produce a completed
review. A selected file missing in both revisions also fails validation.

With no command, checks are `not_run`, not passed. Without `--snapshot`, unchanged
selected files make review unavailable. The CLI's [exit codes](cli-usage.md#reports-and-exit-codes)
distinguish unavailable review from failed executable checks.

Source recollection is not a filesystem lock. Sandboxed command mutations are
contained in the disposable workspace, but concurrent host edits can still change
the reviewed working tree; AssertLens detects selected-file differences and makes
the review unavailable.

## Model judgments are advisory

Jev chooses `supported`, `contradicted`, or `insufficient` for each claim. Reports
retain raw choice, confidence, and all three probabilities. Insufficient evidence
or confidence below 0.8 becomes `needs_review`.

The threshold is an **uncalibrated advisory starting point**. Neither model
confidence nor passing tests proves general correctness. A completed review with
contradictions still exits `0`; there is no model-based merge-blocking mode.

The test suite uses mocked API responses and does not measure live Jev accuracy.
Before considering model-driven blocking, evaluate representative known-good and
buggy changes and measure false positives, misses, and uncertainty.

API contract: [TypeSafe API reference](https://docs.typesafe.ai/api.md).
