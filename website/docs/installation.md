---
title: Installation
description: Set up AssertLens and inspect your first review payload without an API call.
---

## Requirements

- Node.js 24.12 or newer.
- Git and a repository with an existing commit.
- Linux with Bubblewrap (`bwrap`) for default command execution.
- A TypeSafe API key for live Jev reviews. Help, dry runs, and `--check-only` need no key.

Run the CLI from a trusted checkout. It needs only Node and Git; development checks
require the locked dev dependencies.

```bash
git clone https://github.com/danielscoffee/AssertLens.git
cd AssertLens
npm ci --ignore-scripts
npm run typecheck
npm test
```

Tests use temporary Git repositories, subprocesses, and mocked HTTP responses.
They test behavior and failure handling, not live Jev accuracy.

## Inspect a payload first

From the repository root:

```bash
node src/assertlens.ts --snapshot --dry-run
```

The supplied `.assertlens.json` selects the CLI's runtime modules. `--snapshot` allows
review when selected files match the base. `--dry-run` prints the exact outbound
JSON without credentials, network access, or command execution.

Read the selected source and assertions before making a live request. Do not save
sensitive payloads in shared logs. To review a different scope, edit your
[configuration](configuration.md).

## Run a live review

Set `TYPESAFE_API_KEY` through your secret manager or shell environment. Never put
credentials in configuration or source. The CLI does not load `.env` files.

Then run a sandboxed check before asking Jev:

```bash
node src/assertlens.ts --snapshot -- npm test
```

If the check fails, times out, or cannot start, AssertLens exits with code `1` without
calling Jev. A successful check is reported separately from Jev's advisory findings.

:::note Sandbox boundary
AssertLens copies Git-visible files into a disposable writable workspace and runs the
command with Bubblewrap. Network is disabled by default; use `--sandbox-network`
only when required. Ignored files, `.git`, host dependencies, and service credentials
are not exposed. Use `--head REF -- command` to check an immutable committed tree.
:::

Use `--no-sandbox` only for trusted local code that must run in the original
repository. It prints a warning and cannot be combined with `--head`. Bubblewrap
does not cap memory, disk, or process counts; see [Security & limits](security-and-limits.md).

See [CLI usage](cli-usage.md) for comparison modes, output, and exit codes.

## Review another repository

Use this trusted CLI with configuration you have reviewed:

```bash
node src/assertlens.ts --repo /path/to/project --base origin/main --dry-run
```

Configuration defaults to `.assertlens.json` in the target repository's root. Its base
reference must already exist locally, and at least one selected file must differ
unless `--snapshot` is supplied. The CLI does not fetch remote references for you.
