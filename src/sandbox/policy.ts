import { existsSync, realpathSync } from "node:fs";
import { delimiter, sep } from "node:path";
import type { CheckRequest } from "../check/check.ts";

export type BubblewrapPolicy = {
	path: string;
	readonlyPaths: string[];
	networkPaths: string[];
};

const TOOL_ROOTS = [
	"/usr",
	"/bin",
	"/sbin",
	"/lib",
	"/lib64",
	"/nix/store",
	"/run/current-system/sw",
	"/opt",
];
const BASE_PATHS = [
	"/etc/alternatives",
	"/etc/ld.so.cache",
	"/etc/localtime",
];
const NETWORK_PATHS = [
	"/etc/resolv.conf",
	"/etc/hosts",
	"/etc/nsswitch.conf",
	"/etc/gai.conf",
	"/etc/services",
	"/etc/ssl/certs",
	"/etc/pki/tls/certs",
];

function safePath(env: NodeJS.ProcessEnv): string {
	const candidates = [
		...(env.PATH ?? "").split(delimiter),
		"/usr/local/sbin",
		"/usr/local/bin",
		"/usr/sbin",
		"/usr/bin",
		"/sbin",
		"/bin",
	];
	const resolved = candidates.flatMap((path) => {
		if (!path) return [];
		try {
			const real = realpathSync(path);
			return TOOL_ROOTS.some(
				(root) => real === root || real.startsWith(`${root}${sep}`),
			)
				? [real]
				: [];
		} catch {
			return [];
		}
	});
	return [...new Set(resolved)].join(":");
}

export function systemBubblewrapPolicy(
	env: NodeJS.ProcessEnv,
): BubblewrapPolicy {
	return {
		path: safePath(env),
		readonlyPaths: [...TOOL_ROOTS, ...BASE_PATHS].filter(existsSync),
		networkPaths: NETWORK_PATHS.filter(existsSync),
	};
}

function setenv(args: string[], name: string, value: string): void {
	args.push("--setenv", name, value);
}

export function buildBubblewrapArgs(
	request: CheckRequest,
	policy: BubblewrapPolicy,
): string[] {
	const args = [
		"--unshare-user",
		"--unshare-ipc",
		"--unshare-pid",
		"--unshare-uts",
		"--unshare-cgroup-try",
	];
	if (!request.network) args.push("--unshare-net");
	args.push(
		"--disable-userns",
		"--new-session",
		"--die-with-parent",
		"--hostname",
		"assertlens",
		"--clearenv",
		"--dir",
		"/etc",
	);
	for (const path of [
		...policy.readonlyPaths,
		...(request.network ? policy.networkPaths : []),
	]) {
		args.push("--ro-bind", path, path);
	}
	args.push(
		"--proc",
		"/proc",
		"--dev",
		"/dev",
		"--tmpfs",
		"/tmp",
		"--dir",
		"/tmp/home",
		"--bind",
		request.cwd,
		"/workspace",
		"--chdir",
		"/workspace",
	);
	setenv(args, "PATH", policy.path);
	setenv(args, "HOME", "/tmp/home");
	setenv(args, "TMPDIR", "/tmp");
	setenv(args, "LANG", "C.UTF-8");
	if (request.env.CI !== undefined) setenv(args, "CI", "true");
	if (request.env.TERM && /^[A-Za-z0-9._+-]{1,64}$/.test(request.env.TERM))
		setenv(args, "TERM", request.env.TERM);
	if (request.env.NO_COLOR !== undefined) setenv(args, "NO_COLOR", "1");
	if (request.env.FORCE_COLOR !== undefined) setenv(args, "FORCE_COLOR", "1");
	args.push("--", request.command, ...request.args);
	return args;
}
