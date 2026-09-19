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

## Credentials and local commands

Set `TYPESAFE_API_KEY` through your secret manager or shell environment. Do not put
it in configuration or source. The CLI does not load `.env` files.

Local check commands run directly, not through a shell, with a two-minute timeout.
The CLI removes `TYPESAFE_API_KEY`, `GITHUB_TOKEN`, and `GH_TOKEN` from the check
process's environment.

:::danger This is not a sandbox
Removing these tokens does not isolate local code. A command can still access your
machine, files, network, and other credentials. Run only commands and code you
trust. Use a trusted CLI and trusted configuration when reviewing other repositories.
:::

For untrusted PR source, use `--head`. It reads committed Git objects without
checking out their contents and refuses commands. The supplied
[GitHub review workflow](github-actions.md) follows this separation.

## Scope and resource limits

| Resource | Limit |
| --- | --- |
| Selected files | 1–20 unique literal repository-relative paths |
| Named assertions | 1–20 |
| Assertion text | Nonblank, at most 1,000 characters |
| Configuration, state, request, response, and individual source reads | 64,000 bytes each |
| Executable check | Two minutes |
| Jev request | 30 seconds; no automatic retries |

Regular UTF-8 source files only: no symlinks, binaries, traversal, globs, or
submodules. Oversized input fails instead of silently dropping context. The byte
limit is not a token estimate; server context-limit errors also make a review
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

A source snapshot check is not a filesystem lock or a sandbox. It detects selected
source differences when recollected after the command; it does not make concurrent
local activity safe.

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
