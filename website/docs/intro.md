---
title: Introduction
description: Local correctness checks and advisory GitHub pull-request review with Jev.
slug: /
---

AssertLens runs local correctness checks and asks Jev to evaluate explicit assertions
against selected source files. It also provides an advisory GitHub pull-request
review workflow.

The CLI is written in TypeScript. Node 24.12+ runs its source directly, with no
runtime dependencies, server, or build step. This documentation site is a separate
Docusaurus package; the CLI does not depend on it.

:::warning Advisory only
Executable checks test behavior. Jev judges explicit assertions against selected
source. Neither passing tests nor model confidence proves general correctness.
A completed review is not a merge approval.
:::

## Review flow

1. Select files and narrow, falsifiable assertions in `.assertlens.json`.
2. Inspect the exact outbound JSON with `--dry-run` before sharing source.
3. Optionally run a sandboxed check. A failed check stops the review before Jev
   is called.
4. Read the report, which separates executable check status from model judgments.

For each assertion, Jev chooses `supported`, `contradicted`, or `insufficient`.
Insufficient evidence or confidence below 0.8 becomes `needs_review`. This threshold
is an uncalibrated advisory starting point, not a correctness guarantee. There is
no model-based merge-blocking mode.

## Start here

- [Installation](installation.md): requirements and your first dry run.
- [CLI usage](cli-usage.md): working-tree, snapshot, and committed-source reviews.
- [Configuration](configuration.md): selected files and assertions.
- [GitHub Actions](github-actions.md): separate CI from secret-bearing review.
- [Security & limits](security-and-limits.md): what leaves your machine and what
  the tool cannot establish.

## Scope

Only explicitly selected files are reviewed. Include relevant unchanged
dependencies and tests yourself; AssertLens does not discover them.

V1 omits inline PR comments, generated fixes, automatic test generation,
repository-wide dependency discovery, deployments, and auto-merge.
