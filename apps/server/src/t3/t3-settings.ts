// Where T3 Code keeps its state, and what item stats read from its settings,
// read-only. The settings parts follow pingdotgg/t3code main at
// f054d1b8018721bd997d99cbb918a7b17bf098a4: apps/server/src/usage/UsageService.ts,
// claudeUsageReader and codexUsageReader (with CodexHomeLayout's shared home).
// Whether T3 Code runs follows main at 1c1050eb7fddeedb80cc624dcd834e2a04377b1c:
// apps/server/src/serverRuntimeState.ts.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isRecord } from '@lar-factory/shared';
import { readJsonRecord } from '../json-file.ts';
import type { PriceOverride } from '../stats/usage-pricing.ts';

/** T3's state folder under the home folder. */
const userdata = (env: NodeJS.ProcessEnv): string => `${env.HOME ?? ''}/.t3/userdata`;

/** T3's database: `T3_STATE_DB`, or its usual place under the home folder. */
export function statsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_STATE_DB || `${userdata(env)}/statev2.sqlite`;
}

/** T3's settings: `T3_SETTINGS`, or their usual place under the home folder. */
export function t3SettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_SETTINGS || `${userdata(env)}/settings.json`;
}

/** T3's model list: `T3_MODEL_MANIFEST`, or `model-manifest.json` beside T3's settings. */
export function modelManifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_MODEL_MANIFEST || join(dirname(t3SettingsPath(env)), 'model-manifest.json');
}

/** T3's cached price table: `T3_USAGE_RATES`, or `usage-model-rates.json` beside T3's database, in T3's state dir. */
export function usageRatesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_USAGE_RATES || join(dirname(statsDbPath(env)), 'usage-model-rates.json');
}

/** T3's environment id, which its thread links name: `T3_ENVIRONMENT_ID`, or `environment-id` in its userdata folder. */
export function environmentIdPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_ENVIRONMENT_ID || `${userdata(env)}/environment-id`;
}

/** The environment id in the file at `path`, trimmed; undefined when it is missing, blank or can't be read. */
export function readEnvironmentId(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** T3's runtime file, which its server writes on start and removes on stop: `T3_SERVER_RUNTIME`, or `server-runtime.json` in its userdata folder. */
export function serverRuntimePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_SERVER_RUNTIME || `${userdata(env)}/server-runtime.json`;
}

/**
 * Whether T3 Code runs: the runtime file at `path` names a pid whose process is alive, as T3's
 * isProcessAlive checks it. `t3 thread start` needs that file; a crash can leave it behind, naming a dead pid.
 */
export function t3Running(path: string): boolean {
  const pid = readJsonRecord(path)?.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Signal 0 only asks whether the process exists; EPERM means it does, under another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** `~` and `~/…` under `home`, as T3's expandHomePath reads a configured path. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(home, path);
}

// Each provider driver whose transcripts count, and the home its built-in instance
// and any instance without a `homePath` use.
const DRIVER_HOMES = { claudeAgent: '.claude', codex: '.codex' };

export type TranscriptDriver = keyof typeof DRIVER_HOMES;

/** A provider instance's transcripts: its driver and transcript home. */
export interface InstanceHome {
  driver: TranscriptDriver;
  home: string;
}

/** What item stats read from T3's settings. */
export interface T3Settings {
  /** Each Claude and Codex provider instance's transcript home, by instance id. */
  instanceHomes: Map<string, InstanceHome>;
  /** The user's prices by model. */
  priceOverrides: Record<string, PriceOverride>;
  /** The user's model aliases. */
  modelAliases: Record<string, string>;
}

/** T3's settings at `path`, with `~` standing for `home`; as if empty when they can't be read. */
export function readT3Settings(path: string, home: string): T3Settings {
  const settings = readJsonRecord(path);
  return {
    instanceHomes: instanceHomes(settings?.providerInstances, home),
    priceOverrides: priceOverrides(settings?.usagePriceOverrides),
    modelAliases: modelAliases(settings?.usageModelAliases),
  };
}

const isTranscriptDriver = (driver: unknown): driver is TranscriptDriver =>
  typeof driver === 'string' && Object.hasOwn(DRIVER_HOMES, driver);

/**
 * Each Claude and Codex provider instance's home, as T3's claudeUsageReader and
 * codexUsageReader resolve it: the instance's `homePath`, else `~/.claude` or
 * `~/.codex`. The built-in `claudeAgent` and `codex` instances are there even
 * when the settings don't list them or can't be read.
 */
function instanceHomes(instances: unknown, home: string): Map<string, InstanceHome> {
  const homes = new Map(Object.entries(DRIVER_HOMES).map(([driver, dir]) => [driver, { driver: driver as TranscriptDriver, home: join(home, dir) }]));
  if (!isRecord(instances)) return homes;
  for (const [id, instance] of Object.entries(instances as Record<string, { driver?: unknown; config?: { homePath?: unknown } } | null>)) {
    const driver = instance?.driver;
    if (!isTranscriptDriver(driver)) continue;
    const configured = typeof instance?.config?.homePath === 'string' ? instance.config.homePath.trim() : '';
    homes.set(id, { driver, home: configured ? expandHome(configured, home) : join(home, DRIVER_HOMES[driver]) });
  }
  return homes;
}

const isPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The settings' `usagePriceOverrides`, keeping each entry T3's settings schema accepts. */
function priceOverrides(value: unknown): Record<string, PriceOverride> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([model, price]): [string, PriceOverride][] => {
    if (!model.trim() || !isRecord(price) || !isPrice(price.inputCostPerMillionTokens) || !isPrice(price.outputCostPerMillionTokens)) return [];
    const { cacheReadCostPerMillionTokens: read, cacheWriteCostPerMillionTokens: write } = price;
    if ((read !== undefined && !isPrice(read)) || (write !== undefined && !isPrice(write))) return [];
    return [[model.trim(), {
      inputCostPerMillionTokens: price.inputCostPerMillionTokens,
      outputCostPerMillionTokens: price.outputCostPerMillionTokens,
      ...(read === undefined ? {} : { cacheReadCostPerMillionTokens: read }),
      ...(write === undefined ? {} : { cacheWriteCostPerMillionTokens: write }),
    }]];
  }));
}

/** The settings' `usageModelAliases`, trimmed, keeping the non-empty ones. */
function modelAliases(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([model, target]): [string, string][] =>
    typeof target === 'string' && model.trim() && target.trim() ? [[model.trim(), target.trim()]] : []));
}
