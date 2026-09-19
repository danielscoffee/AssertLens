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

test("PR execution has no secrets; trusted review never executes PR code", () => {
	assert.match(ci, /\n {2}pull_request:/);
	assert.doesNotMatch(ci, /secrets\./);
	assert.match(ci, /persist-credentials: false/);
	assert.match(ci, /run: npm run typecheck/);
	assert.match(ci, /run: npm test/);
	assert.match(review, /\n {2}pull_request:/);
	assert.doesNotMatch(review, /pull_request_target|workflow_run/);
	assert.match(
		review,
		/ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
	);
	assert.match(
		review,
		/git fetch --no-tags origin "refs\/pull\/\$PR_NUMBER\/head"/,
	);
	assert.match(review, /"\$\(git rev-parse FETCH_HEAD\)" != "\$PR_HEAD_SHA"/);
	assert.match(
		review,
		/node src\/qg-jev\.ts --base "\$PR_BASE_SHA" --head "\$PR_HEAD_SHA"/,
	);
	assert.doesNotMatch(
		review,
		/git (checkout|switch)|npm (ci|install|test)|download-artifact|actions\/cache/,
	);
	assert.equal(
		(
			review.match(
				/TYPESAFE_API_KEY: \$\{\{ secrets\.TYPESAFE_API_KEY \}\}/g,
			) ?? []
		).length,
		1,
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
