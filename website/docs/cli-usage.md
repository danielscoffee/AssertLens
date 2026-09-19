---
title: CLI usage
description: Compare working files or committed Git objects and interpret AssertLens reports.
---

Run from the AssertLens repository root:

```bash
node src/assertlens.ts [options] [-- trusted-command args...]
```

## Options

| Option | Behavior |
| --- | --- |
| `--repo PATH` | Repository to review; defaults to the current directory. |
| `--config PATH` | Configuration path relative to the target repository root; defaults to `.assertlens.json`. |
| `--base REF` | Base commit reference; defaults to `HEAD`. |
| `--head REF` | Read committed Git data instead of working files; compare against the merge base. Refuses commands. |
| `--snapshot` | Allow review even when selected files match the base. |
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

# Run a trusted check before the advisory review.
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

Use `--head` to inspect Git objects without checking out or executing their source:

```bash
node src/assertlens.ts --base origin/main --head HEAD --dry-run
node src/assertlens.ts --base origin/main --head HEAD --json
```

This mode uses the merge base of `--base` and `--head` as the before revision.
Working-tree changes are not included. Keep both the CLI and its configuration
trusted when reviewing another repository.

## Executable checks

`--` separates the executable command and its arguments. The command runs in the
target repository root, directly rather than through a shell, with a two-minute
timeout. Shell operators such as pipes and `&&` are not interpreted.

Check output goes to stderr. Stdout contains one Markdown or JSON report, or the
JSON payload for a dry run. No command means `checks: not_run`, not passed.

A failed, timed-out, or unstartable check exits `1` without calling Jev. If selected
source changes during a successful check, review is unavailable rather than
sending a stale snapshot. `--head` and `--dry-run` reject commands.

Local checks are not sandboxed; see [Security & limits](security-and-limits.md).

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
