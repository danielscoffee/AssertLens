import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bounded, object } from "./validation.ts";

const MODEL = "jev-1.13.0";

export type Config = {
	model: string;
	files: string[];
	assertions: Record<string, string>;
};

export function loadConfig(path: string): Config {
	let value: unknown;
	try {
		value = JSON.parse(bounded(readFileSync(path, "utf8"), "Configuration"));
	} catch {
		throw new Error("Cannot read configuration: expected a bounded JSON file.");
	}
	if (
		!object(value) ||
		Object.keys(value).some(
			(key) => !["model", "files", "assertions"].includes(key),
		)
	) {
		throw new Error(
			"Invalid configuration fields. Expected model, files, assertions.",
		);
	}
	const model = value.model ?? MODEL;
	if (typeof model !== "string" || !/^jev-[a-z0-9.-]+$/.test(model))
		throw new Error("Invalid Jev model.");
	if (
		!Array.isArray(value.files) ||
		value.files.length < 1 ||
		value.files.length > 20
	) {
		throw new Error("Configuration needs 1–20 explicit files.");
	}
	const files: string[] = value.files.map((path: unknown) => {
		if (
			typeof path !== "string" ||
			!path ||
			isAbsolute(path) ||
			/[\\:*?[\]\x00-\x1f]/.test(path) ||
			path.split("/").some((part) => ["", ".", ".."].includes(part))
		) {
			throw new Error(
				"Selected files must be literal relative paths without traversal or globs.",
			);
		}
		if (
			/(^|\/)(\.git|\.env(?:\..*)?|id_[^/]+|credentials(?:\..*)?|secrets?(?:\..*)?)(\/|$)|\.(pem|key|p12|pfx)$/i.test(
				path,
			)
		) {
			throw new Error("Sensitive paths cannot be selected for review.");
		}
		return path;
	});
	if (new Set(files).size !== files.length)
		throw new Error("Duplicate selected files.");
	if (
		!object(value.assertions) ||
		Object.keys(value.assertions).length < 1 ||
		Object.keys(value.assertions).length > 20
	) {
		throw new Error("Configuration needs 1–20 named assertions.");
	}
	const assertions: Record<string, string> = {};
	for (const [id, text] of Object.entries(value.assertions)) {
		if (
			!/^[a-z][a-z0-9_]{0,63}$/.test(id) ||
			typeof text !== "string" ||
			!text.trim() ||
			text.length > 1_000
		) {
			throw new Error(
				"Invalid assertion: use a short identifier and 1–1000 characters of text.",
			);
		}
		assertions[id] = text;
	}
	return { model, files, assertions };
}
