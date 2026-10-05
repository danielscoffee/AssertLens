import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { object } from "../shared/validation.ts";

const SOURCE = ["src", "lib", "app", "source", "pkg", "internal"];
const TESTS = ["test", "tests", "__tests__", "spec"];

function folder(repo: string, names: string[]): string | undefined {
	return names.find((name) => {
		try {
			return statSync(join(repo, name)).isDirectory();
		} catch {
			return false;
		}
	});
}

// Starter configuration from conventional folders. The assertions are generic
// starting points; replace them with narrow claims about your code.
export function initConfig(repo: string, path: string): void {
	const source = folder(repo, SOURCE);
	if (!source)
		throw new Error(
			`No source folder found (${SOURCE.join(", ")}); write .assertlens.json by hand.`,
		);
	const tests = folder(repo, TESTS);
	const config = {
		provider: "jev",
		assertions: {
			errors_handled: {
				text: "Errors from I/O, parsing, and external calls in the selected source are handled or propagated, never silently ignored.",
				files: [`${source}/`],
			},
			...(tests && {
				changes_tested: {
					text: "The selected tests exercise the behavior changed in the selected source.",
					files: [`${source}/`, `${tests}/`],
				},
			}),
		},
	};
	try {
		writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
	} catch (error) {
		if (object(error) && error.code === "EEXIST")
			throw new Error("Configuration already exists; it was not overwritten.");
		throw error;
	}
}
