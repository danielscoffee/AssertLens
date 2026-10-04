import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ci = readFileSync(
	new URL("../.github/workflows/ci.yml", import.meta.url),
	"utf8",
);
const review = readFileSync(
	new URL("../.github/workflows/jev-review.yml", import.meta.url),
	"utf8",
);
const docs = readFileSync(
	new URL("../.github/workflows/docs.yml", import.meta.url),
	"utf8",
);
const image = readFileSync(
	new URL("../.github/workflows/image.yml", import.meta.url),
	"utf8",
);
const release = readFileSync(
	new URL("../.github/workflows/release.yml", import.meta.url),
	"utf8",
);
const publishImage = readFileSync(
	new URL("../.github/scripts/publish-image.sh", import.meta.url),
	"utf8",
);
const action = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

const immutableFetch =
	/git fetch --no-tags origin "refs\/pull\/\$PR_NUMBER\/head"[\s\S]*"\$\(git rev-parse FETCH_HEAD\)" != "\$PR_HEAD_SHA"/;
const temporaryFetchAuth =
	/GITHUB_TOKEN: \$\{\{ github\.token \}\}[\s\S]*AUTH_HEADER="\$\(printf 'x-access-token:%s' "\$GITHUB_TOKEN" \| base64 \| tr -d '\\n'\)"[\s\S]*echo "::add-mask::\$AUTH_HEADER"[\s\S]*GIT_CONFIG_COUNT=1 \\\n\s*GIT_CONFIG_KEY_0=http\.https:\/\/github\.com\/\.extraheader \\\n\s*GIT_CONFIG_VALUE_0="AUTHORIZATION: basic \$AUTH_HEADER" \\\n\s*git fetch --no-tags origin "refs\/pull\/\$PR_NUMBER\/head"[\s\S]*unset AUTH_HEADER GITHUB_TOKEN/;

function assertSandboxSetup(workflow: string): void {
	assert.match(workflow, /apt-get install --yes bubblewrap/);
	assert.match(workflow, /kernel\.apparmor_restrict_unprivileged_userns=0/);
	assert.match(
		workflow,
		/bwrap --ro-bind \/ \/ --unshare-user --unshare-pid --disable-userns -- \/bin\/true/,
	);
	assert.match(
		workflow,
		/node --test --test-name-pattern='real Bubblewrap' test\/sandbox\.test\.ts/,
	);
}

test("CI executes immutable PR source only through trusted sandbox tooling", () => {
	assert.match(ci, /\n {2}pull_request:/);
	assert.doesNotMatch(ci, /pull_request_target|workflow_run|secrets\./);
	assert.match(
		ci,
		/ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/,
	);
	assert.match(ci, /fetch-depth: 0/);
	assert.match(ci, /persist-credentials: false/);
	assert.match(ci, immutableFetch);
	assert.match(ci, temporaryFetchAuth);
	assert.doesNotMatch(ci, /AUTHORIZATION: bearer|Remove checkout credentials|unset-all .*extraheader/);
	assertSandboxSetup(ci);
	assert.match(
		ci,
		/npm install --global --ignore-scripts "typescript@\$TYPESCRIPT_VERSION" "@types\/node@\$NODE_TYPES_VERSION"/,
	);
	assert.match(
		ci,
		/node src\/assertlens\.ts --head "\$CHECK_HEAD_SHA" --check-only -- tsc --noEmit --typeRoots "\$TYPE_ROOTS"/,
	);
	assert.match(
		ci,
		/node src\/assertlens\.ts --head "\$CHECK_HEAD_SHA" --check-only -- npm test/,
	);
	assert.doesNotMatch(ci, /run: npm (ci|run typecheck|test)/);
	assert.doesNotMatch(ci, /git (checkout|switch)|download-artifact|actions\/cache/);
	assert.ok(
		ci.indexOf("Run trusted Bubblewrap integration smoke") <
			ci.indexOf("Sandbox PR typecheck"),
	);
});

test("trusted Jev review sandboxes PR tests and scopes its secret to final step", () => {
	assert.match(review, /\n {2}pull_request:/);
	assert.doesNotMatch(review, /pull_request_target|workflow_run/);
	assert.match(
		review,
		/ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
	);
	assert.match(review, /persist-credentials: false/);
	assert.match(review, immutableFetch);
	assert.match(review, temporaryFetchAuth);
	assert.doesNotMatch(review, /AUTHORIZATION: bearer|Remove checkout credentials|unset-all .*extraheader/);
	assertSandboxSetup(review);
	assert.match(
		review,
		/node src\/assertlens\.ts --base "\$PR_BASE_SHA" --head "\$PR_HEAD_SHA" -- npm test/,
	);
	assert.doesNotMatch(
		review,
		/git (checkout|switch)|npm (ci|install)|download-artifact|actions\/cache/,
	);
	assert.match(
		review,
		/\|\| status=\$\?\n\s+if \[ "\$status" -eq 3 \]; then\n\s+echo '::notice::[^']+'\n\s+exit 0\n\s+fi\n\s+exit "\$status"/,
	);
	assert.equal(
		(
			review.match(
				/TYPESAFE_API_KEY: \$\{\{ secrets\.TYPESAFE_API_KEY \}\}/g,
			) ?? []
		).length,
		1,
	);
	assert.ok(
		review.indexOf("Run trusted Bubblewrap integration smoke") <
			review.indexOf("Sandbox tests and review immutable PR source"),
	);
});

test("workflows use read-only tokens, bounded jobs, and pinned official actions", () => {
	for (const workflow of [ci, review]) {
		assert.match(workflow, /permissions:\n {2}contents: read/);
		assert.match(workflow, /timeout-minutes: \d+/);
		assert.doesNotMatch(workflow, /: write/);
		for (const [, action] of workflow.matchAll(/uses: (\S+)/g)) {
			assert.match(action, /^actions\/(checkout|setup-node)@[a-f0-9]{40}$/);
		}
	}
});

test("docs deploy to Pages only from main with job-scoped write access", () => {
	const [build, deploy] = docs.split("\n  deploy:\n");
	assert.match(build, /permissions:\n {2}contents: read/);
	assert.doesNotMatch(build, /: write|secrets\./);
	assert.match(build, /persist-credentials: false/);
	assert.match(build, /npm ci --prefix website --ignore-scripts/);
	assert.match(
		deploy,
		/if: \$\{\{ github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main' \}\}/,
	);
	assert.match(deploy, /permissions:\n {6}pages: write\n {6}id-token: write/);
	assert.doesNotMatch(docs, /pull_request_target|workflow_run|secrets\./);
	for (const [, action] of docs.matchAll(/uses: (\S+)/g))
		assert.match(
			action,
			/^actions\/(checkout|setup-node|upload-pages-artifact|deploy-pages)@[a-f0-9]{40}$/,
		);
});

test("image publishes to GHCR only from main with job-scoped write access", () => {
	const [build, publish] = image.split("\n  publish:\n");
	assert.match(build, /permissions:\n {2}contents: read/);
	assert.doesNotMatch(build, /: write|docker (login|push)/);
	assert.match(build, /--security-opt seccomp=unconfined --security-opt apparmor=unconfined/);
	assert.match(
		publish,
		/if: \$\{\{ github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main' \}\}/,
	);
	assert.match(publish, /permissions:\n {6}contents: read\n {6}packages: write/);
	assert.match(publish, /run: \.github\/scripts\/publish-image\.sh main "sha-/);
	assert.match(publishImage, /^set -euo pipefail$/m);
	assert.match(publishImage, /docker login ghcr\.io --username "\$GITHUB_ACTOR" --password-stdin/);
	assert.doesNotMatch(image, /pull_request_target|workflow_run|secrets\.|tags:/);
	for (const workflow of [image, action, release])
		for (const [, uses] of workflow.matchAll(/uses: (\S+)/g))
			assert.match(uses, /^(\.\/|actions\/(checkout|setup-node)@[a-f0-9]{40})$/);
	assert.match(dockerfile, /^FROM node:24-[\w-]+@sha256:[a-f0-9]{64}$/m);
	assert.match(dockerfile, /^USER node$/m);
});

test("composite action passes inputs through the environment, not script text", () => {
	assert.match(action, /using: composite/);
	const scripts = [...action.matchAll(/run: \|\n((?: {8}.*\n?)+)/g)].map(
		([, script]) => script,
	);
	assert.equal(scripts.length, 2);
	for (const script of scripts) assert.doesNotMatch(script, /\$\{\{/);
	assert.match(action, /node "\$GITHUB_ACTION_PATH\/src\/assertlens\.ts" "\$\{args\[@\]\}"/);
	assert.doesNotMatch(action, /eval |bash -c|sh -c|--no-sandbox/);
	assert.match(action, /\|\| status=\$\?\n\s+if \[ "\$status" -eq 3 \]; then/);
});

test("semver tags gate releases and scope each deploy's write access", () => {
	assert.match(release, /on:\n {2}push:\n {4}tags: \["v\*"\]\n\n/);
	assert.doesNotMatch(release, /pull_request|workflow_dispatch|secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/);
	const jobs = Object.fromEntries(
		release
			.split(/\n {2}(?=[a-z-]+:\n {4}(?:runs-on|needs))/)
			.slice(1)
			.map((job) => [job.slice(0, job.indexOf(":")), job]),
	);
	assert.deepEqual(Object.keys(jobs), ["verify", "npm", "image", "github-release"]);
	assert.doesNotMatch(jobs.verify, /permissions:|: write/);
	assert.match(jobs.verify, /does not match package\.json version/);
	assert.match(jobs.verify, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
	assert.match(jobs.verify, /npm run typecheck\n\s+npm test\n\s+npm run build/);
	assert.match(jobs.npm, /needs: verify/);
	assert.match(jobs.npm, /environment:\n {6}name: npm/);
	assert.match(jobs.npm, /permissions:\n {6}contents: read\n {6}id-token: write\n/);
	assert.match(jobs.npm, /npm publish --access public --tag "\$NPM_TAG"/);
	assert.match(jobs.image, /environment:\n {6}name: ghcr/);
	assert.match(jobs.image, /permissions:\n {6}contents: read\n {6}packages: write\n/);
	assert.match(jobs["github-release"], /needs: \[verify, npm, image\]/);
	assert.match(jobs["github-release"], /permissions:\n {6}contents: write\n/);
});
