// T3 Code's provider instances and the Install targets each one reads lar's skills from. It asks T3's running server
// for `server.getConfig` over its authenticated WebSocket RPC, as T3's own client does, following T3 Code nightly
// 0.1.6 (20261030): apps/server's `/ws` route, EnvironmentAuth's websocket tickets and Effect RPC's JSON framing.
// Folders per driver follow docs/research/594-agent-skill-folders.md, checked against that build's ClaudeHome,
// inspectCursorSkills and FX_HOME_ROOTS. An instance's environment is read for `HOME` alone and never leaves here.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isRecord } from './is-record.ts';

/** How lar's skills go into a target: a Claude home's `skills/`, an Antigravity folder, or the shared `~/.agents/skills`. */
export type InstallTargetKind = 'claude' | 'antigravity' | 'agents';

/** A folder where the board app installs lar's skills. */
export interface InstallTarget {
  kind: InstallTargetKind;
  path: string;
}

/** One provider instance T3 runs threads on, and its Install targets; none for a driver lar doesn't know. */
export interface ProviderInstance {
  id: string;
  driver: string;
  displayName: string;
  enabled: boolean;
  targets: InstallTarget[];
}

/** Why T3's instances couldn't be read. */
export type UnavailableReason = 'not-running' | 'unauthenticated' | 'timed-out' | 'failed';

export type InstanceDiscovery =
  | { available: true; instances: ProviderInstance[] }
  | { available: false; reason: UnavailableReason };

/** Runs the `t3` CLI with these arguments; the caller finds `t3` on the shell's PATH. */
export type T3Run = (args: string[], signal: AbortSignal) => Promise<{ code: number | null; stdout: string }>;

export interface DiscoverOptions {
  /** The user's home. */
  home: string;
  /** T3's `server-runtime.json`, which names its server's origin while it runs. */
  runtimePath: string;
  runT3: T3Run;
  /** How long discovery may take in all; 5 seconds by default. */
  timeoutMs?: number;
}

/** The parts of an instance's T3 settings its targets depend on. */
export interface InstanceSettings {
  config?: unknown;
  environment?: unknown;
}

const AGENTS = '.agents/skills';
const ANTIGRAVITY = ['.gemini/config/skills', '.gemini/antigravity-cli/skills'];
/** Drivers that read `~/.agents/skills`. Codex's own `$CODEX_HOME/skills` is deprecated, so it gets nothing there. */
const AGENTS_DRIVERS = new Set(['codex', 'cursor', 'grok', 'opencode', 'fx', 'muse', 'pi']);

/**
 * The Install targets of an instance of `driver`, under `home` or the absolute `HOME` its environment sets. A Claude
 * instance's `config.homePath`, with `~` for `home` as T3's ClaudeHome expands it, replaces its `~/.claude`.
 */
export function installTargets(driver: string, home: string, settings: InstanceSettings = {}): InstallTarget[] {
  const userHome = environmentHome(settings.environment) ?? home;
  if (driver === 'claudeAgent') {
    const homePath = isRecord(settings.config) && typeof settings.config.homePath === 'string' ? settings.config.homePath.trim() : '';
    return [{ kind: 'claude', path: join(homePath ? expandHome(homePath, home) : join(userHome, '.claude'), 'skills') }];
  }
  if (driver === 'antigravity') return ANTIGRAVITY.map((folder) => ({ kind: 'antigravity', path: join(userHome, folder) }));
  if (AGENTS_DRIVERS.has(driver)) return [{ kind: 'agents', path: join(userHome, AGENTS) }];
  return [];
}

/** The absolute `HOME` in an instance's environment list; T3 blanks a sensitive value. */
function environmentHome(environment: unknown): string | undefined {
  if (!Array.isArray(environment)) return undefined;
  const entry: unknown = environment.find((variable: unknown) => isRecord(variable) && variable.name === 'HOME');
  const value = isRecord(entry) && typeof entry.value === 'string' ? entry.value.trim() : '';
  return isAbsolute(value) ? value : undefined;
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return resolve(home, path);
}

class Unavailable extends Error {
  readonly reason: UnavailableReason;
  constructor(reason: UnavailableReason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Every provider instance T3's `server.getConfig` lists, built-in defaults and disabled ones included, with their
 * Install targets. It issues a one-minute `orchestration:read` session through `t3 auth session issue`, trades it for
 * an RPC websocket ticket, asks once and revokes the session. Within `timeoutMs` it answers unavailable instead.
 */
export async function discoverProviderInstances(options: DiscoverOptions): Promise<InstanceDiscovery> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Unavailable('timed-out'));
    }, options.timeoutMs ?? 5_000);
  });
  try {
    const config = await Promise.race([askT3(options, controller.signal), deadline]);
    return { available: true, instances: providerInstances(config, options.home) };
  } catch (error) {
    return { available: false, reason: error instanceof Unavailable ? error.reason : 'failed' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** T3's `server.getConfig` answer. */
async function askT3({ runtimePath, runT3 }: DiscoverOptions, signal: AbortSignal): Promise<unknown> {
  const origin = runtimeOrigin(runtimePath);
  if (!origin) throw new Unavailable('not-running');
  // The session's token goes only to a server on this machine, whatever the runtime file names.
  if (!LOOPBACK.has(origin.hostname)) throw new Unavailable('failed');
  const session = issued(await runT3(['auth', 'session', 'issue', '--scope', 'orchestration:read', '--ttl', '1m', '--label', 'Lar Factory', '--json'], signal));
  try {
    const ticket = await websocketTicket(origin, session.token, signal);
    return await getConfig(origin, ticket, signal);
  } finally {
    // The session expires within a minute anyway.
    runT3(['auth', 'session', 'revoke', session.sessionId], AbortSignal.timeout(10_000)).catch(() => {});
  }
}

/** The hosts a T3 on this machine listens at, as `URL.hostname` writes them. */
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);

function runtimeOrigin(path: string): URL | undefined {
  try {
    const runtime: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(runtime) && typeof runtime.origin === 'string' ? new URL(runtime.origin) : undefined;
  } catch {
    return undefined;
  }
}

function issued({ code, stdout }: { code: number | null; stdout: string }): { sessionId: string; token: string } {
  try {
    const session: unknown = JSON.parse(stdout);
    if (code === 0 && isRecord(session) && typeof session.sessionId === 'string' && typeof session.token === 'string') {
      return { sessionId: session.sessionId, token: session.token };
    }
  } catch { /* Not the CLI's JSON answer. */ }
  throw new Unavailable('unauthenticated');
}

async function websocketTicket(origin: URL, token: string, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    // A redirect fails rather than carry the token on to wherever it points.
    response = await fetch(new URL('/api/auth/websocket-ticket/rpc', origin), {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal,
    });
  } catch {
    throw new Unavailable(signal.aborted ? 'timed-out' : 'not-running');
  }
  if (response.status === 401 || response.status === 403) throw new Unavailable('unauthenticated');
  const answer: unknown = response.ok ? await response.json() : undefined;
  if (!isRecord(answer) || typeof answer.ticket !== 'string') throw new Unavailable('failed');
  return answer.ticket;
}

/** Sends one `server.getConfig` request over T3's `/ws` and resolves with its success value. */
function getConfig(origin: URL, ticket: string, signal: AbortSignal): Promise<unknown> {
  const url = new URL('/ws', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('orchestrationProtocol', '2');
  url.searchParams.set('wsTicket', ticket);
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      socket.close();
      reject(new Unavailable('timed-out'));
    });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ _tag: 'Request', id: '1', tag: 'server.getConfig', payload: {}, headers: [] })));
    socket.addEventListener('message', (event) => {
      let message: unknown;
      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : undefined;
      } catch {
        // A throw here would escape the promise into the main process.
        socket.close();
        reject(new Unavailable('failed'));
        return;
      }
      if (!isRecord(message)) return;
      if (message._tag === 'Ping') socket.send(JSON.stringify({ _tag: 'Pong' }));
      if (message._tag !== 'Exit' || message.requestId !== '1') return;
      socket.close();
      const exit = message.exit;
      if (isRecord(exit) && exit._tag === 'Success') resolve(exit.value);
      else reject(new Unavailable('failed'));
    });
    socket.addEventListener('error', () => reject(new Unavailable('failed')));
    socket.addEventListener('close', () => reject(new Unavailable('failed')));
  });
}

/** Each listed provider and its targets, from its settings entry when T3 has one. */
function providerInstances(config: unknown, home: string): ProviderInstance[] {
  if (!isRecord(config) || !Array.isArray(config.providers)) throw new Unavailable('failed');
  const settings = isRecord(config.settings) && isRecord(config.settings.providerInstances) ? config.settings.providerInstances : {};
  return config.providers.flatMap((provider: unknown): ProviderInstance[] => {
    if (!isRecord(provider) || typeof provider.instanceId !== 'string' || typeof provider.driver !== 'string') return [];
    const { instanceId: id, driver } = provider;
    const entry = Object.hasOwn(settings, id) ? settings[id] : undefined;
    return [{
      id,
      driver,
      displayName: typeof provider.displayName === 'string' ? provider.displayName : id,
      enabled: provider.enabled === true,
      targets: installTargets(driver, home, isRecord(entry) ? { config: entry.config, environment: entry.environment } : {}),
    }];
  });
}
