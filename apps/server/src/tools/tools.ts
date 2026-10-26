// Finds the `t3`, `gh`, `az`, `git`, `jq` and `curl` binaries the way a Mac app opened from Finder must,
// whose inherited PATH is often just /usr/bin:/bin. Copies T3 Code's lookup.

import { accessSync, constants, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { GH_FLOOR, type CheckedTool, type ToolCheck, type ToolChecks } from '@lar-factory/shared';
import { serverRuntimePath, t3Running } from '../t3/t3-settings.ts';
import { type RunResult, runTool } from './run-tool.ts';

export const TOOL_NAMES = ['t3', 'gh', 'az', 'git', 'jq', 'curl'] as const;
export type ToolName = typeof TOOL_NAMES[number];

const OVERRIDES: Record<ToolName, string> = { t3: 'T3_PATH', gh: 'GH_PATH', az: 'AZ_PATH', git: 'GIT_PATH', jq: 'JQ_PATH', curl: 'CURL_PATH' };
/** The command that installs a missing tool; T3 Code installs t3. */
const INSTALL: Partial<Record<ToolName, string>> = { gh: 'brew install gh', az: 'brew install azure-cli', git: 'brew install git', jq: 'brew install jq', curl: 'brew install curl' };
const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const START = '__LAR_BOARD_PATH_START__';
const END = '__LAR_BOARD_PATH_END__';

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
  return { ...Object.fromEntries(TOOL_NAMES.map((name) => [name, find(name)])) as Record<ToolName, ToolLookup>, searchPath };
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

/** The failed check for a tool the last lookup didn't find, naming the override that pointed nowhere, if one did. */
function missingCheck(name: ToolName): ToolCheck {
  const lookup = current?.[name];
  const override = lookup && lookup.path === null ? lookup.override : undefined;
  const fix = INSTALL[name];
  return { result: 'missing', ...(override && { override }), ...(fix && { fix }) };
}

/** The first version number on the first line of a `--version` output, else that line; undefined when it's empty. */
export function versionOf(stdout: string): string | undefined {
  const line = stdout.trim().split('\n')[0]!.trim();
  return line.match(/\d+\.\d+[\w.+-]*/)?.[0] ?? (line || undefined);
}

/** Runs `<tool> --version`: the tool passes when it runs, with the version if it printed one with status 0. */
async function checkVersion(name: ToolName): Promise<ToolCheck> {
  const command = toolCommand(name);
  if (!command) return missingCheck(name);
  const { code, stdout } = await runTool(command.file, ['--version'], { env: command.env, timeout: 5_000 });
  // A string code is a spawn error: the binary went away or can't run since the lookup.
  if (typeof code === 'string') return missingCheck(name);
  const version = code === 0 ? versionOf(stdout) : undefined;
  return { result: 'ok', ...(version && { version }) };
}

/** What the gh probe found: gh's check, and gh's error for the Stale banner when a probe failed without a notice of its own. */
export interface GhProbe {
  check: ToolCheck;
  error?: string;
}

const LOGGED_OUT = /not logged in|gh auth login/i;

/** Whether `version` is older than GH_FLOOR; false when it isn't a version number. */
function olderThanFloor(version: string | undefined): boolean {
  const parts = version?.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if (!parts) return false;
  const floor = GH_FLOOR.split('.').map(Number);
  const i = parts.findIndex((part, j) => part !== floor[j]);
  return i !== -1 && parts[i]! < floor[i]!;
}

/**
 * The token's scopes from `gh auth status`, or null when the board can't read them: no scopes line
 * (GH_TOKEN, a fine-grained token), a line naming none, or one line per account.
 */
function scopesOf(status: string): string[] | null {
  const lines = status.match(/Token scopes:.*/g);
  if (lines?.length !== 1) return null;
  const scopes = [...lines[0]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
  return scopes.length ? scopes : null;
}

/** What a logged-in gh's version and scopes say: a missing project scope first, as it blocks reading. */
function loggedInCheck(version: string | undefined, scopes: string[] | null): ToolCheck {
  if (scopes && !scopes.includes('project')) return { result: 'no-project-scope', ...(version && { version }), fix: 'gh auth refresh -s project' };
  const unread = scopes ? {} : { scopes: 'unread' as const };
  if (olderThanFloor(version)) return { result: 'outdated', version: version!, fix: 'brew upgrade gh', ...unread };
  return { result: 'ok', ...(version && { version }), ...unread };
}

/**
 * Probes gh as T3 Code does: `gh --version`, then `gh auth status`, 5 s each, reading the version and the
 * token's scopes. A timeout, or an auth status failure that isn't a logout, returns gh's error for the Stale banner.
 */
export async function probeGh(): Promise<GhProbe> {
  const command = toolCommand('gh');
  if (!command) return { check: missingCheck('gh') };
  const run = (args: string[]) => runTool(command.file, args, { env: command.env, timeout: 5_000 });
  /** A failed run's probe: missing on a spawn error, which means gh went away or can't run since the lookup; else gh's error. */
  const failed = ({ code, detail }: RunResult, args: string[], version?: string): GhProbe => {
    if (typeof code === 'string') return { check: missingCheck('gh') };
    // No code means a signal, which here is the timeout.
    return { check: { result: 'ok', ...(version && { version }) }, error: `gh ${args.join(' ')} failed: ${code === null ? 'timed out after 5 s' : detail}` };
  };
  const versionRun = await run(['--version']);
  if (versionRun.code !== 0) return failed(versionRun, ['--version']);
  const version = versionOf(versionRun.stdout);
  const status = await run(['auth', 'status']);
  // Older gh prints the status to stderr.
  if (status.code === 0) return { check: loggedInCheck(version, scopesOf(`${status.stdout}\n${status.stderr}`)) };
  if (typeof status.code === 'number' && LOGGED_OUT.test(status.stderr || status.stdout)) {
    return { check: { result: 'logged-out', ...(version && { version }), fix: 'gh auth login' } };
  }
  return failed(status, ['auth', 'status'], version);
}

/**
 * Probes az: `az --version`, then `az account show` and `az extension show --name azure-devops`, 10 s each,
 * as az is slow to start. A signed-out az names `az login`, which comes before a missing extension.
 */
export async function probeAz(): Promise<ToolCheck> {
  const command = toolCommand('az');
  if (!command) return missingCheck('az');
  const run = (args: string[]) => runTool(command.file, args, { env: command.env, timeout: 10_000 });
  const versionRun = await run(['--version']);
  // A string code is a spawn error: az went away or can't run since the lookup.
  if (typeof versionRun.code === 'string') return missingCheck('az');
  const version = versionRun.code === 0 ? versionOf(versionRun.stdout) : undefined;
  const [account, extension] = await Promise.all([run(['account', 'show']), run(['extension', 'show', '--name', 'azure-devops'])]);
  if (account.code !== 0) return { result: 'logged-out', ...(version && { version }), fix: 'az login' };
  if (extension.code !== 0) return { result: 'no-extension', ...(version && { version }), fix: 'az extension add --name azure-devops' };
  return { result: 'ok', ...(version && { version }) };
}

/** Checks t3 runs, then that T3 Code is running, as its runtime file at `runtime` says. */
async function checkT3(runtime: string): Promise<ToolCheck> {
  const check = await checkVersion('t3');
  if (check.result !== 'ok' || t3Running(runtime)) return check;
  return { result: 'not-running', ...(check.version && { version: check.version }) };
}

/**
 * Checks every command the board needs from the last lookup, together, and az only when `withAz` is set, as
 * only a repository on Azure DevOps needs it. t3 also needs T3 Code running, which T3's runtime file at
 * `t3Runtime` tells. `ghError` is the gh probe's error for the Stale banner.
 */
export async function checkTools(withAz: boolean, t3Runtime = serverRuntimePath()): Promise<{ tools: ToolChecks; ghError?: string }> {
  const others = ['git', 'jq', 'curl'] as const satisfies readonly CheckedTool[];
  const [gh, az, t3, ...checks] = await Promise.all([probeGh(), withAz ? probeAz() : undefined, checkT3(t3Runtime), ...others.map(checkVersion)]);
  const tools = { gh: gh.check, t3, ...Object.fromEntries(others.map((name, i) => [name, checks[i]!])), ...(az && { az }) } as ToolChecks;
  return { tools, ...(gh.error && { ghError: gh.error }) };
}
