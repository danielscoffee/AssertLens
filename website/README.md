# AssertLens documentation

Docs-only [Docusaurus 3.10.2](https://docusaurus.io/docs) site. Dependencies and
lockfile are isolated from the root CLI package. Requires Node 24.12+ and npm.

## Develop

From the repository root:

```bash
npm ci --prefix website --ignore-scripts
npm run --prefix website start
```

Open <http://localhost:3000>. Edit Markdown in `website/docs/`; the explicit page
order lives in `website/sidebars.ts`. The introduction is served at `/`.

## Validate and preview

```bash
npm run --prefix website typecheck
npm run --prefix website build
npm run --prefix website serve
```

The build writes static output to `website/build/` and fails on broken links or
anchors. No TypeSafe API key is needed to develop or build the docs.

The existing root CI checks the CLI, not this site. Run the commands above when
changing documentation.

## Dependency overrides

Docusaurus 3.10.2's build/dev-server dependency ranges include older
`serialize-javascript` and `uuid` releases. `package.json` overrides select patched
versions for [serialization advisories](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v)
and the [UUID bounds-check advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
The scoped UUID override keeps CommonJS compatibility for SockJS.

Recheck `npm audit --prefix website` when upgrading Docusaurus; remove these
overrides when upstream dependency ranges include patched releases.

## Before publishing

`website/docusaurus.config.ts` uses `http://localhost:3000` as its preview URL.
Set `url` to the real site origin and `baseUrl` to its hosting path before
publishing, so generated links and canonical URLs use the correct location.

No deployment workflow or hosting target is configured. Blog, sample landing
page, search, versioning, and custom branding are intentionally omitted.
