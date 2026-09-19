---
title: CLI usage
description: Compare working files or committed Git objects and interpret AssertLens reports.
---

Run from the AssertLens repository root:

```bash
node src/assertlens.ts [options] [-- command args...]
```

## Options

| Option | Behavior |
| --- | --- |
| `--repo PATH` | Repository to review; defaults to the current directory. |
| `--config PATH` | Configuration path relative to the target repository root; defaults to `.assertlens.json`. |
| `--base REF` | Base commit reference; defaults to `HEAD`. |
| `--head REF` | Read committed Git data instead of working files; sandboxed commands run against that exact tree. |
| `--snapshot` | Allow review even when selected files match the base. |
| `--check-only` | Run the command without loading review configuration or calling Jev. |
| `--sandbox-network` | Share host networking with a sandboxed command; disabled by default. |
| `--no-sandbox` | Run a trusted local command directly; incompatible with `--head`. |
| `--dry-run` | Print outbound JSON without an API call or command execution. Refuses commands. |
| `--json` | Emit a machine-readable report instead of Markdown. |
| `--help` | Show usage and options. |

An existing Git commit is required for review. All references must be available
locally. By default, at least one selected file must differ from the base.

## Working-tree review

Local mode compares selected files on disk directly against `--base`, including
selected untracked files. It reads the working tree, not the staging index, so it
is not a staged-only review. Changes that exist only in the index are not reviewed.

```bash
# Inspect the payload before sending source.
node src/assertlens.ts --base HEAD --dry-run

# Run a sandboxed check before the advisory review.
node src/assertlens.ts --base HEAD -- npm test
```

The payload contains full before/after contents of every selected file, not just
diffs. Changes outside that scope are not reviewed.

## Snapshot review

Use `--snapshot` to review selected source even with a clean working tree:

```bash
node src/assertlens.ts --snapshot --dry-run
node src/assertlens.ts --snapshot -- npm test
```

This only relaxes the requirement for changed files. It still includes full
before/after contents against the chosen base and enforces the same validation
and size limits.

## Committed-source review

Use `--head` to inspect Git objects without checking them out on the host:

```bash
node src/assertlens.ts --base origin/main --head HEAD --dry-run
node src/assertlens.ts --base origin/main --head HEAD --json
node src/assertlens.ts --base origin/main --head HEAD -- npm test
```

This mode uses the merge base of `--base` and `--head` as the before revision.
Working-tree changes are not included. A command runs against a disposable copy of
the exact committed tree. Keep the CLI and configuration trusted when reviewing
another repository.

## Executable checks

`--` separates the executable command and its arguments. By default, AssertLens
creates a writable disposable workspace containing only Git-visible files, then runs
the command without a shell inside Bubblewrap. Local mode includes all tracked files,
even when ignore rules match, plus untracked files that are not ignored. `--head`
materializes the exact committed tree. `.git` and untracked ignored files such as host
dependency directories are absent. The timeout is two minutes.
Shell operators such as pipes and `&&` are not interpreted.

Network is disabled by default. `--sandbox-network` explicitly retains host
networking for commands that need it. Check output goes to stderr. Stdout contains
one Markdown or JSON report, or the JSON payload for a dry run. No command means
`checks: not_run`, not passed.

A failed, timed-out, or unstartable check exits `1` without calling Jev. If selected
host source changes during a successful check, review is unavailable rather than
sending a stale snapshot. `--dry-run` rejects commands.

Use check-only mode for CI or isolated execution without configuration or Jev:

```bash
node src/assertlens.ts --head HEAD --check-only -- npm test
```

`--check-only` writes status to stderr and returns `0`, `1`, or `2`; it cannot be
combined with `--json` or `--dry-run`. `--no-sandbox` instead runs trusted local code
in the original repository, prints a warning, and cannot be combined with `--head`.
See [Security & limits](security-and-limits.md).

## Reports and exit codes

Reports retain each assertion's raw choice, confidence, and probabilities for
`supported`, `contradicted`, and `insufficient`. A raw choice of `insufficient`, or
confidence below 0.8, produces the verdict `needs_review`.

| Exit | Meaning |
| --- | --- |
| `0` | Advisory review, help, or dry run completed. **Not approval.** |
| `1` | Executable check failed, timed out, or could not start. Jev was not called. |
| `2` | Invalid input or unavailable/incomplete review, including unchanged scope without `--snapshot`. |

A completed review can contain contradictions and still exit `0`. Read its findings;
do not treat the exit code as a model-based merge gate.
