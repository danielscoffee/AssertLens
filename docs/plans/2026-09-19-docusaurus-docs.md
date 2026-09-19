# Docusaurus Documentation Site Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add an isolated, buildable Docusaurus site documenting AssertLens.

**Architecture:** Keep site under `website/` so documentation dependencies do not affect the root CLI package. Use Docusaurus classic TypeScript template in docs-only mode, with explicit navigation and Markdown pages adapted from the existing README.

**Tech Stack:** Docusaurus 3, React, TypeScript, Markdown, npm

---

### Task 1: Scaffold site

**Files:**

- Create: `website/`

1. Run `npm_config_ignore_scripts=true npx --yes create-docusaurus@3.10.2 website classic --typescript --skip-install --package-manager npm`.
2. Trim unused scaffold scripts and dependencies; install with `npm install --prefix website --ignore-scripts` and retain the lockfile.
3. Remove tutorial, blog, sample landing page, and unused assets.

### Task 2: Create documentation

**Files:**

- Create: `website/docs/intro.md`
- Create: `website/docs/installation.md`
- Create: `website/docs/cli-usage.md`
- Create: `website/docs/configuration.md`
- Create: `website/docs/github-actions.md`
- Create: `website/docs/security-and-limits.md`

1. Adapt verified commands and constraints from `README.md`.
2. Keep executable checks distinct from advisory Jev judgments.
3. Preserve credential, untrusted-code, and GitHub secret-boundary warnings.

### Task 3: Configure docs-only site

**Files:**

- Modify: `website/docusaurus.config.ts`
- Modify: `website/sidebars.ts`
- Remove: `website/src/` (unused sample UI and custom CSS)
- Retain: `website/.gitignore` (generated output exclusions)
- Modify: `website/README.md`
- Modify: `README.md`

1. Serve docs from `/` and map introduction to homepage.
2. Disable blog and remove generated landing-page route.
3. Add explicit sidebar, repository link, metadata, and the default classic theme.
4. Keep generated output ignored; document local development and preview commands.
5. Keep the site URL local until a hosting target is chosen; configure no deployment.

### Task 4: Verify

1. Run `npm run typecheck` and `npm test` at repository root.
2. Run `npm run typecheck` and `npm run build` in `website/`.
3. Run diagnostics on changed TypeScript files before building.
4. Check rendered routes and navigation, and inspect dependency audit results.
5. Inspect Git diff and use Jev to assess explicit documentation/configuration claims.

No test-first unit is added: changes are generated scaffold, configuration, and Markdown content; Docusaurus typecheck/build are executable acceptance checks.

## Validation results

Historical results from the initial docs setup; path references use current AssertLens names.

- `npm ci --prefix website --ignore-scripts`: passed with the isolated lockfile.
- `npm run --prefix website typecheck`: passed.
- `npm run --prefix website build`: passed; six docs routes generated with strict link and anchor checks.
- `npm run typecheck && npm test`: passed; all 27 existing tests passed.
- `npm audit --prefix website`: zero reported vulnerabilities after scoped dependency overrides documented in `website/README.md`.
- Native Node smoke checks: all six built pages have expected headings/navigation; all six dev-server routes return HTTP 200. The temporary server was stopped. No visual browser audit was performed.
- `node --test --test-name-pattern='snapshot|untracked|committed-head|dry-run captures' test/assertlens.test.ts`: all seven focused tests passed.
- A temporary-Git-repository check confirmed working-tree contents take precedence over the index, index-only changes are not reviewed, and snapshot mode permits unchanged working source.
- LSP initially retained pre-install import errors; a targeted full refresh and subsequent `lens_diagnostics` all reported no issues.
- `git diff --check`: passed. Generated site output and dependencies remain ignored.

Jev advisory review (`jev-1.13.0`) supported docs-only routing and preserved safety boundaries at confidence 0.99. Its initial comparison-mode judgment had confidence 0.77; this prompted the focused checks above and explicit clarification that index-only changes are not reviewed. Follow-up review supported that revised description at confidence 0.93. These judgments are advisory, not correctness proofs.

No deployment, push, or commit was performed. Root CLI code, dependencies, and workflows remain unchanged.
