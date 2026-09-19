import {
	accessSync,
	constants,
	realpathSync,
	statSync,
} from "node:fs";
import { delimiter, isAbsolute, join, sep } from "node:path";

const TRUSTED_ROOTS = [
	"/usr",
	"/bin",
	"/sbin",
	"/nix/store",
	"/run/current-system/sw",
];
const DEFAULT_PATH = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

function canonical(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

function trusted(path: string): boolean {
	return TRUSTED_ROOTS.some((root) => {
		const realRoot = canonical(root);
		return realRoot !== undefined &&
			(path === realRoot || path.startsWith(`${realRoot}${sep}`));
	});
}

function directories(path: string): string[] {
	return [...new Set([...path.split(delimiter), ...DEFAULT_PATH])].filter(
		(directory) => directory !== "" && isAbsolute(directory),
	);
}

export function trustedExecutablePath(path = process.env.PATH ?? ""): string {
	return [...new Set(directories(path).flatMap((directory) => {
		const real = canonical(directory);
		return real !== undefined && trusted(real) ? [real] : [];
	}))].join(delimiter);
}

export function resolveTrustedExecutable(
	name: string,
	path = process.env.PATH ?? "",
): string {
	if (!/^[A-Za-z0-9._+-]+$/.test(name))
		throw new Error("Trusted executable name must not contain a path.");
	for (const directory of directories(path)) {
		const executable = canonical(join(directory, name));
		if (executable === undefined || !trusted(executable)) continue;
		try {
			if (!statSync(executable).isFile()) continue;
			accessSync(executable, constants.X_OK);
			return executable;
		} catch {
			// Keep searching trusted roots.
		}
	}
	throw new Error(`No trusted ${name} executable found.`);
}
