# AssertLens Sandbox Design

**Status:** Approved

## Goal

Run local checks and untrusted pull-request checks through one Linux Bubblewrap policy while reorganizing the flat source tree into feature modules with hexagonal boundaries.

## Scope

- Sandbox commands by default on Linux with Bubblewrap.
- Support local working-tree checks and committed `--head` checks.
- Use a disposable writable workspace containing only Git-visible files.
- Disable network by default; allow explicit `--sandbox-network` opt-in.
- Keep `--no-sandbox` as an explicit local-only escape hatch.
- Add check-only execution for GitHub CI without Jev credentials.
- Preserve the existing two-minute timeout.
- Migrate all runtime source into feature folders.

Memory, disk, and process-count quotas are out of scope. Untrusted code can still cause resource denial of service before the timeout.

## Module layout

```text
src/
  assertlens.ts                 # CLI composition root

  application/
    review.ts                   # orchestration use case

  config/
    config.ts                   # parsing and validation

  git/
    git.ts                      # repository port and domain types
    cli.ts                      # Git CLI adapter
    state.ts                    # before/after collection
    workspace.ts                # disposable Git-visible workspace

  check/
    check.ts                    # CheckRunner port
    direct.ts                   # explicit --no-sandbox adapter

  sandbox/
    bubblewrap.ts               # CheckRunner implementation
    policy.ts                   # mounts, environment, and network policy

  jev/
    jev.ts                      # ReviewClient port and types
    request.ts                  # pure request construction
    http.ts                     # TypeSafe HTTP adapter
    response.ts                 # response validation

  report/
    report.ts                   # pure Markdown rendering

  shared/
    validation.ts               # reused guards and limits
    process.ts                  # normalized subprocess execution
```

Feature folders keep ports and adapters close. Ports model application needs rather than tool APIs. Pure config, request, response, validation, and rendering code stays concrete. Composition happens only in `src/assertlens.ts`. No barrel files, one-function scaffolding, or naming prefixes such as `IRepository`.

Existing root exports for request construction, review, and report rendering remain available from `src/assertlens.ts`.

## Execution flow

1. CLI parses options and creates concrete adapters.
2. Review use case loads configuration and asks the Git adapter for selected before/after state.
3. When a command is present, the Git adapter creates a disposable workspace:
   - Local mode copies tracked and unignored working-tree files.
   - `--head` mode materializes the exact committed tree.
4. The selected `CheckRunner` executes in that workspace:
   - Bubblewrap by default.
   - Direct runner only with `--no-sandbox` in local mode.
5. Workspace cleanup runs in `finally`.
6. Failed, timed-out, or unstartable checks exit `1`; Jev is not called.
7. Successful checks trigger source-state recollection. Concurrent host changes invalidate review.
8. Jev client evaluates the request and the report renderer emits Markdown or JSON.

`--check-only` stages and executes a command without loading review configuration or calling Jev. GitHub workflows use the trusted base-branch CLI with a fetched, verified PR commit:

```bash
node src/assertlens.ts --repo . --head "$PR_HEAD_SHA" --check-only -- npm test
```

## Sandbox policy

Bubblewrap must create user, PID, IPC, UTS, mount, and—unless explicitly shared—network namespaces. Setup uses a new terminal session, dies with its parent, and disables nested user namespaces. Setup failure is fatal; AssertLens never falls back silently.

The sandbox receives:

- Writable disposable workspace at `/workspace`.
- Synthetic `/proc` and `/dev`.
- Private temporary directory and home.
- Read-only Linux toolchain paths needed to launch installed commands.
- Minimal safe environment: `PATH`, locale, terminal/color settings, and `CI`.

It does not receive the original repository, `.git`, ignored files, host home, service credentials, runtime sockets, or network access by default. `--sandbox-network` retains the host network namespace and is valid only for sandboxed commands.

`--no-sandbox --head` is rejected. `--dry-run` continues to reject commands. Command logs remain on stderr so stdout stays machine-readable.

## Error semantics

Expected command outcomes use a result value containing status, signal, timeout, and startup error. Nonzero status, signal, timeout, or startup failure means `checks: failed` and exit `1`.

Invalid options, invalid configuration, and unavailable review remain exit `2`. Workspace creation or cleanup errors produce explicit unavailable/failed output and never continue to Jev. Sandboxed mutations are discarded; direct mode retains existing selected-source mutation detection.

## Verification strategy

Development follows red-green-refactor.

- Port tests use small fakes for process, Git, check runner, and Jev boundaries.
- Git workspace tests cover tracked edits, untracked files, deletions, executable modes, symlinks, ignored files, and committed-head materialization.
- Policy tests cover namespaces, mounts, environment clearing, network default, and network opt-in.
- Linux Bubblewrap integration tests cover host-file denial, ignored-secret exclusion, host-repository immutability, writable workspace, credential removal, network isolation, and timeout cleanup.
- Existing CLI tests remain end-to-end.
- Workflow tests enforce trusted-base tooling, immutable PR SHA verification, read-only permissions, Bubblewrap preflight, sandboxed PR checks, and narrow Jev-secret scope.

Real Bubblewrap tests may skip when unavailable locally. GitHub workflow preflight must fail when Bubblewrap is unavailable, preventing silent CI skips.

Final verification runs LSP diagnostics, TypeScript checking, all tests, workflow lint, a real Bubblewrap smoke test, lens diagnostics, and advisory Jev correctness checks using changed source and test evidence.

## Rejected alternatives

- **Bind original repository:** faster, but exposes ignored files and risks host mutation.
- **Workflow-only shell policy:** duplicates security behavior and leaves local execution inconsistent.
- **OCI container:** heavier than required for the selected Linux-only scope.
- **Global layer folders:** separates related ports and adapters, making navigation harder.
- **Interfaces for pure functions:** abstraction without a boundary or alternate implementation.
