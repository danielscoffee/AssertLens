---
title: Configuration
description: Define explicit source scope and falsifiable assertions in .assertlens.json.
---

Create `.assertlens.json` in the repository you want to review. The only accepted
fields are `model`, `files`, and `assertions`.

The following example assumes those source and test files exist in your project:

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
your test suite. Prefer narrow, falsifiable claims over “this code is correct.”

## Fields

| Field | Rules |
| --- | --- |
| `model` | Optional; defaults to `jev-1.13.0`. Must match `^jev-[a-z0-9.-]+$`. |
| `files` | Required array of 1–20 unique, literal repository-relative paths. |
| `assertions` | Required object containing 1–20 named claims. |

Assertion identifiers must match `^[a-z][a-z0-9_]{0,63}$`: start with a lowercase
letter, followed by lowercase letters, digits, or underscores, up to 64 characters
total. Claim text must be a nonblank string of at most 1,000 characters.

A model name passing local validation does not guarantee service availability.
See the [TypeSafe model reference](https://docs.typesafe.ai/models.md) for current
model information.

## Select enough context

Only listed files are sent. Include relevant unchanged dependencies and tests
explicitly; the CLI does not discover them or expand imports.

Paths cannot contain traversal, globs, backslashes, or absolute paths. Selected
source must be regular UTF-8 text. Symlinks, binaries, and submodules are rejected.
A selected file missing in both revisions is invalid; a file added or deleted
between revisions is supported.

Secret-like paths are rejected as an accident guard, **not a secret scanner**.
Never select files containing credentials or personal data, even if their paths
look harmless.

## What Jev receives

- Full before/after contents of every selected file, with missing revisions
  represented as `null`.
- Resolved base commit and either the head commit or `working-tree` marker.
- Executable check status, but not check logs.
- Your assertion text as typed questions.

Each question asks Jev to evaluate the **after** version using the selected scope.
Missing or ambiguous evidence should produce `insufficient`, not an assumption
that omitted code is correct.

Inspect the exact request without credentials or network access:

```bash
node src/assertlens.ts --snapshot --dry-run
```

## Custom configuration path

`--config` resolves relative to the reviewed repository's root, including when
`--repo` points elsewhere:

```bash
node src/assertlens.ts --repo /path/to/project \
  --config review/auth.json --snapshot --dry-run
```

Use trusted configuration and tooling. Payload sizes and failure handling are
described in [Security & limits](security-and-limits.md).
