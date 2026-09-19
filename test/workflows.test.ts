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
