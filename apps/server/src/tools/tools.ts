// Finds the `t3`, `gh` and `az` binaries the way a Mac app opened from Finder must,
// whose inherited PATH is often just /usr/bin:/bin. Copies T3 Code's lookup.

import { accessSync, constants, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { ToolMissing, ToolProblem } from '@mux-factory/shared';
import { runTool } from './run-tool.ts';

export const TOOL_NAMES = ['t3', 'gh', 'az'] as const;
export type ToolName = typeof TOOL_NAMES[number];

const OVERRIDES: Record<ToolName, string> = { t3: 'T3_PATH', gh: 'GH_PATH', az: 'AZ_PATH' };
const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const START = '__MUX_BOARD_PATH_START__';
const END = '__MUX_BOARD_PATH_END__';

/** A found tool's path, or null with the override that pointed nowhere, if one did. */
type ToolLookup = { path: string } | { path: null; override?: string };

export interface Tools extends Record<ToolName, ToolLookup> {
  /** The PATH the lookup searched; tools run with it. */
  searchPath: string;
}

/** The login shell PATH first, then the inherited one, then the Homebrew folders, without empty entries or duplicates. */
export function mergePaths(loginPath: string | null, inherited: string | undefined, fallbackDirs = FALLBACK_DIRS): string {
  const dirs = [loginPath, inherited].flatMap((path) => path?.split(':') ?? []);
  return [...new Set([...dirs, ...fallbackDirs].filter(Boolean))].join(':');
}

function runnable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function onPath(name: string, searchPath: string): string | null {
  for (const dir of searchPath.split(':')) {
    const file = join(dir, name);
    if (runnable(file)) return file;
  }
  return null;
}

/**
 * Looks each tool up: a nonempty override first (checked as given when it holds a `/`,
 * with no fallback; looked up on the PATH when it's a bare name), else its own name on the PATH.
 */
export function findTools(env: NodeJS.ProcessEnv, loginPath: string | null, fallbackDirs = FALLBACK_DIRS): Tools {
  const searchPath = mergePaths(loginPath, env.PATH, fallbackDirs);
  const find = (name: ToolName): ToolLookup => {
    const value = env[OVERRIDES[name]];
    if (!value) return { path: onPath(name, searchPath) };
    const path = value.includes('/') ? (runnable(value) ? value : null) : onPath(value, searchPath);
    return path ? { path } : { path: null, override: `${OVERRIDES[name]}=${value}` };
  };
  return { t3: find('t3'), gh: find('gh'), az: find('az'), searchPath };
}

async function output(file: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<string | null> {
  const { code, stdout } = await runTool(file, args, { env, timeout });
  return code === 0 ? stdout : null;
}

function accountShell(): string | undefined {
  try {
    return userInfo().shell ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The login shell's PATH: `<shell> -ilc` printing it between marker lines (5 s), else
 * `launchctl getenv PATH` (2 s), else null. The shell is $SHELL, else the account's, else zsh.
 */
export async function readLoginPath(env: NodeJS.ProcessEnv, launchctl = '/bin/launchctl'): Promise<string | null> {
  const shell = env.SHELL || accountShell() || '/bin/zsh';
  const printed = await output(shell, ['-ilc', `printf '\\n%s\\n%s\\n%s\\n' '${START}' "$PATH" '${END}'`], env, 5_000);
  const match = printed?.match(new RegExp(`${START}\\n(.*)\\n${END}`));
  if (match?.[1]) return match[1];
  return (await output(launchctl, ['getenv', 'PATH'], env, 2_000))?.trim() || null;
}

let current: Tools | null = null;
let loginPath: string | null = null;

/**
 * Looks every tool up again. It reads the login shell PATH first on the first lookup and when
 * `rereadLoginPath` is set (startup and Recheck); the timed retry keeps the PATH it last read.
 */
export async function lookUpTools(env: NodeJS.ProcessEnv = process.env, rereadLoginPath = true): Promise<Tools> {
  if (rereadLoginPath || !current) loginPath = await readLoginPath(env);
  current = findTools(env, loginPath);
  return current;
}

/** The last lookup's result, or null before the first. */
export function tools(): Tools | null {
  return current;
}

/** How to run a tool the last lookup found, or null when it's missing. */
export function toolCommand(name: ToolName): { file: string; env: NodeJS.ProcessEnv } | null {
  const path = current?.[name].path;
  return path ? { file: path, env: { ...process.env, PATH: current!.searchPath } } : null;
}

/** Why a tool can't run, as a clause without a full stop: missing, naming the override that pointed nowhere. */
export function missingTool(name: ToolName): string {
  const lookup = current?.[name];
  const override = lookup && lookup.path === null ? lookup.override : undefined;
  return override ? `${name} was not found at ${override}` : `${name} was not found`;
}

/** The notice for a tool the last lookup didn't find, naming the override that pointed nowhere; undefined when found. */
export function lookupProblem(name: ToolName): ToolMissing | undefined {
  const lookup = current?.[name];
  if (!lookup || lookup.path !== null) return undefined;
  return lookup.override ? { problem: 'missing', override: lookup.override } : { problem: 'missing' };
}

/** What the gh probe found: a problem with a notice of its own, or gh's error for the Stale banner. Neither when gh works. */
export interface GhProbe {
  problem?: ToolProblem;
  error?: string;
}

const LOGGED_OUT = /not logged in|gh auth login/i;

/**
 * Probes gh as T3 Code does: `gh --version`, then `gh auth status`, 5 s each. A timeout, or
 * an auth status failure that isn't a logout, returns gh's error for the Stale banner.
 */
export async function probeGh(): Promise<GhProbe> {
  const command = toolCommand('gh');
  if (!command) return { problem: lookupProblem('gh') ?? { problem: 'missing' } };
  for (const args of [['--version'], ['auth', 'status']]) {
    const { code, stdout, stderr, detail } = await runTool(command.file, args, { env: command.env, timeout: 5_000 });
    if (code === 0) continue;
    // A string code is a spawn error: the binary went away or can't run since the lookup.
    if (typeof code === 'string') return { problem: { problem: 'missing' } };
    if (args[0] === 'auth' && typeof code === 'number' && LOGGED_OUT.test(stderr || stdout)) {
      return { problem: { problem: 'logged-out' } };
    }
    // No code means a signal, which here is the timeout.
    return { error: `gh ${args.join(' ')} failed: ${code === null ? 'timed out after 5 s' : detail}` };
  }
  return {};
}
