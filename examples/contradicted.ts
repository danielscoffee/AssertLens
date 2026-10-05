// Builds a throwaway repository with an off-by-one change and reviews it:
//   node examples/contradicted.ts [provider] [model] [endpoint]
// The review runs live when the provider's API key is set or an endpoint is
// given (for example a local Ollama server); otherwise the request is printed.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { providers, type Provider } from "../src/providers/types.ts";

const cli = fileURLToPath(new URL("../src/assertlens.ts", import.meta.url));
const [provider = "jev", model, endpoint] = process.argv.slice(2);
if (!Object.hasOwn(providers, provider))
	throw new Error(`Unknown provider ${provider}; use ${Object.keys(providers).join(", ")}.`);
const key = providers[provider as Provider].key;
const repo = mkdtempSync(join(tmpdir(), "assertlens-example-"));
const write = (path: string, text: string) => writeFileSync(join(repo, path), text);
const git = (...args: string[]) =>
	execFileSync(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"user.name=Example",
			"-c",
			"user.email=example@example.invalid",
			...args,
		],
		{ cwd: repo, stdio: "ignore" },
	);

try {
	git("init", "-q");
	write("eligible.ts", "export const eligible = (age: number) => age >= 18;\n");
	write(
		".assertlens.json",
		JSON.stringify({
			provider,
			...(model && { model }),
			files: ["eligible.ts"],
			assertions: { adults_eligible: "An 18-year-old is eligible." },
		}),
	);
	git("add", ".");
	git("commit", "-qm", "Eligibility starts at 18");
	// The bug: > instead of >=, so 18-year-olds are now rejected.
	write("eligible.ts", "export const eligible = (age: number) => age > 18;\n");
	const live = Boolean(process.env[key]?.trim() || endpoint);
	if (!live)
		process.stderr.write(
			`${key} is not set; printing the request instead of a live review.\n`,
		);
	const result = spawnSync(
		process.execPath,
		[
			cli,
			"--repo",
			repo,
			...(endpoint ? ["--endpoint", endpoint] : []),
			...(live ? [] : ["--dry-run"]),
		],
		{ stdio: "inherit" },
	);
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(repo, { recursive: true, force: true });
}
