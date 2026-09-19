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
const removeCredentials =
	/git config --local --unset-all http\.https:\/\/github\.com\/\.extraheader \|\| true/;

function assertSandboxSetup(workflow: string): void {
	assert.match(workflow, /apt-get install --yes bubblewrap/);
	assert.match(workflow, /kernel\.apparmor_restrict_unprivileged_userns=0/);
	assert.match(
		workflow,
		/bwrap --ro-bind \/ \/ --unshare-user --unshare-pid --disable-userns -- \/bin\/true/,
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
	assert.match(ci, /persist-credentials: true/);
	assert.match(ci, immutableFetch);
	assert.match(ci, removeCredentials);
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
	assert.ok(ci.indexOf("Remove checkout credentials") < ci.indexOf("Sandbox PR typecheck"));
});

test("trusted Jev review sandboxes PR tests and scopes its secret to final step", () => {
	assert.match(review, /\n {2}pull_request:/);
	assert.doesNotMatch(review, /pull_request_target|workflow_run/);
	assert.match(
		review,
		/ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
	);
	assert.match(review, immutableFetch);
	assert.match(review, removeCredentials);
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
		review.indexOf("Remove checkout credentials") <
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
