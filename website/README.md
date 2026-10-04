# AssertLens documentation

Docs-only [Docusaurus 3.10.2](https://docusaurus.io/docs) site. Dependencies and
lockfile are isolated from the root CLI package. Requires Node 24.12+ and npm.

## Develop

From the repository root:

```bash
npm ci --prefix website --ignore-scripts
npm run --prefix website start
```

Open <http://localhost:3000/AssertLens/>. Edit Markdown in `website/docs/`; the explicit page
order lives in `website/sidebars.ts`. The introduction is served at `/`.

## Validate and preview

```bash
npm run --prefix website typecheck
npm run --prefix website build
npm run --prefix website serve
```

The build writes static output to `website/build/` and fails on broken links or
anchors. No TypeSafe API key is needed to develop or build the docs.

The root `CI` workflow checks the CLI, not this site. The `Docs` workflow
(`.github/workflows/docs.yml`) typechecks and builds the site on pull requests that
touch `website/`.

## Dependency overrides

Docusaurus 3.10.2's build/dev-server dependency ranges include older
`serialize-javascript` and `uuid` releases. `package.json` overrides select patched
versions for [serialization advisories](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v)
and the [UUID bounds-check advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
The scoped UUID override keeps CommonJS compatibility for SockJS.

Recheck `npm audit --prefix website` when upgrading Docusaurus; remove these
overrides when upstream dependency ranges include patched releases.

## Deploy

The site is published to GitHub Pages at <https://danielscoffee.github.io/AssertLens/>.
Pushes to `main` that change `website/` build the site and deploy `website/build/`;
run the `Docs` workflow manually to redeploy without changes. Only the deploy job
gets `pages: write` and `id-token: write`; pull-request builds are read-only and
never deploy.

One-time setup: in the repository's **Settings → Pages**, set **Source** to
**GitHub Actions**.

`url` and `baseUrl` in `website/docusaurus.config.ts` must match the Pages
location. If you move to a custom domain, set `url` to its origin and `baseUrl` to
`/`, then configure the domain in the Pages settings.

Blog, sample landing page, search, versioning, and custom branding are
intentionally omitted.
