---
title: Installation
description: Set up AssertLens and inspect your first review payload without an API call.
---

## Requirements

- Node.js 24.12 or newer.
- Git and a repository with an existing commit.
- Linux with Bubblewrap (`bwrap`) for default command execution.
- A TypeSafe API key for live Jev reviews. Help, dry runs, and `--check-only` need no key.

Install the published CLI from npm:

```bash
npm install --global assertlens
assertlens --help
```

The examples below use a source checkout and `node src/assertlens.ts`; an installed
`assertlens` accepts the same options. Images and the reusable action are described
in [GitHub Actions](github-actions.md).

Or run the CLI from a trusted checkout. It needs only Node and Git; development checks
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

## Start a configuration

`--init` writes a starter `.assertlens.json` from a detected source folder (`src`,
`lib`, `app`, ...) and test folder (`test`, `tests`, `__tests__`, `spec`). It never
overwrites an existing file. Replace its generic assertions with narrow,
falsifiable claims about your code:

```bash
assertlens --init
```

To see a contradicted finding end to end, run
`node examples/contradicted.ts [provider] [model] [endpoint]` from a source checkout.
It reviews an off-by-one change against "An 18-year-old is eligible." live when the
provider's API key is set or an endpoint is given, and prints the request otherwise.
For example, `node examples/contradicted.ts anthropic` with `ANTHROPIC_API_KEY`, or a
local Ollama server with
`node examples/contradicted.ts openai qwen2.5:7b http://localhost:11434/v1/chat/completions`.
Provider APIs need API keys; Claude and ChatGPT subscriptions do not include API access.

## Inspect a payload first

From the repository root:

```bash
node src/assertlens.ts --snapshot --dry-run
```

The supplied `.assertlens.json` selects the CLI's runtime modules through
per-assertion folder scopes. `--snapshot` allows
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
command with Bubblewrap. Local staging includes all tracked files even when ignore
rules match, plus untracked files that are not ignored. Network is disabled by
default; use `--sandbox-network` only when required. `.git`, untracked ignored files,
and service credentials are not exposed. Use `--head REF -- command` to check an
immutable committed tree.
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
reference must already exist locally. Without `--snapshot`, at least one selected file
must differ; otherwise review is `not_run` and the CLI exits `3`. The CLI does not fetch remote references for you.
