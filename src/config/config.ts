import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bounded, object } from "../shared/validation.ts";

const MODEL = "jev-1.13.0";

export type Config = {
	model: string;
	files: string[];
	assertions: Record<string, string>;
};

// Assertions sharing the same file entries form one scope and one Jev request.
export type ReviewConfig = Config & { scopes: Config[] };

const MAX_ENTRIES = 20;

// Literal relative path; a trailing slash selects a folder.
export function reviewablePath(path: unknown): string {
	const literal = typeof path === "string" ? path.replace(/\/$/, "") : "";
	if (
		!literal ||
		isAbsolute(literal) ||
		/[\\:*?[\]\x00-\x1f]/.test(literal) ||
		literal.split("/").some((part) => ["", ".", ".."].includes(part))
	) {
		throw new Error(
			"Selected files must be literal relative paths without traversal or globs.",
		);
	}
	if (
		/(^|\/)(\.git|\.env(?:\..*)?|id_[^/]+|credentials(?:\..*)?|secrets?(?:\..*)?)(\/|$)|\.(pem|key|p12|pfx)$/i.test(
			literal,
		)
	) {
		throw new Error("Sensitive paths cannot be selected for review.");
	}
	return path as string;
}

function entries(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length < 1 ||
		value.length > MAX_ENTRIES
	) {
		throw new Error("Configuration needs 1–20 explicit files or folders.");
	}
	const files = value.map(reviewablePath);
	if (new Set(files).size !== files.length)
		throw new Error("Duplicate selected files.");
	return files;
}

export function loadConfig(path: string): ReviewConfig {
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
	const defaults = value.files === undefined ? undefined : entries(value.files);
	if (
		!object(value.assertions) ||
		Object.keys(value.assertions).length < 1 ||
		Object.keys(value.assertions).length > MAX_ENTRIES
	) {
		throw new Error("Configuration needs 1–20 named assertions.");
	}
	const assertions: Record<string, string> = {};
	const scopes = new Map<string, Config>();
	for (const [id, spec] of Object.entries(value.assertions)) {
		const own = object(spec) ? spec : { text: spec };
		const text = own.text;
		if (
			!/^[a-z][a-z0-9_]{0,63}$/.test(id) ||
			Object.keys(own).some((key) => !["text", "files"].includes(key)) ||
			typeof text !== "string" ||
			!text.trim() ||
			text.length > 1_000
		) {
			throw new Error(
				"Invalid assertion: use a short identifier and 1–1000 characters of text.",
			);
		}
		const files = own.files === undefined ? defaults : entries(own.files);
		if (!files)
			throw new Error(
				"Each assertion needs files: set top-level files or the assertion's own files.",
			);
		const key = JSON.stringify([...files].sort());
		const scope = scopes.get(key) ?? { model, files, assertions: {} };
		scope.assertions[id] = text;
		scopes.set(key, scope);
		assertions[id] = text;
	}
	const files = [...new Set([...scopes.values()].flatMap((scope) => scope.files))];
	return { model, files, assertions, scopes: [...scopes.values()] };
}
