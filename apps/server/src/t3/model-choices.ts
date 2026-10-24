// The model choices Start offers, from T3 Code's settings and model list, read-only
// (docs/adr/0005). Only instance ids, display names, model slugs and model names
// leave this file: the settings may hold secrets. Which instances are enabled and
// what they're called follow pingdotgg/t3code main at a68e6e97c501d265e1edccb47b96f8365c8e38f4:
// resolveProviderInstanceEnabled in packages/contracts/src/settings.ts,
// deriveProviderInstanceConfigMap in apps/server/src/provider/ProviderInstanceRegistryHydration.ts
// and resolveProviderInstanceDisplayName in packages/client-runtime/src/state/providerInstanceDisplay.ts.

import { readFileSync } from 'node:fs';
import { readSettings } from '../stats/item-stats.ts';
import { isRecord, offers } from '@mux-factory/shared';
import type { ModelChoice, ModelGroup, ModelOption } from '@mux-factory/shared';

/** Each driver's name in T3 (PROVIDER_DISPLAY_NAMES). */
const DRIVER_NAMES: Record<string, string> = {
  antigravity: 'Antigravity', codex: 'Codex', claudeAgent: 'Claude', cursor: 'Cursor', grok: 'Grok',
  muse: 'Muse Code', acpRegistry: 'ACP Registry', pi: 'Pi', opencode: 'OpenCode',
};

/** Drivers whose settings default to off. */
const DISABLED_BY_DEFAULT = new Set(['cursor', 'grok', 'muse', 'pi', 'opencode', 'antigravity']);

/** Built-in instances (id = driver) that are on while the settings don't list them; the others are off. */
const BUILT_IN_ENABLED = ['codex', 'claudeAgent'];

interface Instance {
  id: string;
  driver: string;
  displayName?: unknown;
  enabled?: unknown;
  config?: unknown;
}

/**
 * "T3 default" aside, the choices Start offers: each enabled provider instance with its
 * driver's current models in manifest order, then its custom models. Empty when the
 * settings or the model list can't be read.
 */
export function loadModelChoices(settingsPath: string, manifestPath: string): ModelGroup[] {
  const settings = readSettings(settingsPath);
  const manifest = readManifest(manifestPath);
  if (!settings || !manifest) return [];
  return instances(settings).filter(enabled).flatMap((instance) => {
    const models = uniqueBySlug([...currentModels(manifest, instance.driver), ...customModels(instance.config)]);
    return models.length ? [{ instanceId: instance.id, name: displayName(instance), models }] : [];
  });
}

/** The offered choice `input` names, or null when it names none (or anything else). */
export function findModelChoice(groups: readonly ModelGroup[], input: unknown): ModelChoice | null {
  if (!isRecord(input) || Object.keys(input).length !== 2) return null;
  const { instanceId, model } = input;
  if (typeof instanceId !== 'string' || typeof model !== 'string') return null;
  const choice = { instanceId, model };
  return offers(groups, choice) ? choice : null;
}

/** The manifest inside T3's cached model list, or null when it can't be read. */
function readManifest(path: string): Record<string, unknown> | null {
  try {
    const cached: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(cached) && isRecord(cached.manifest) ? cached.manifest : null;
  } catch {
    return null;
  }
}

/** The settings' instances, then each built-in instance they don't list. */
function instances(settings: Record<string, unknown>): Instance[] {
  const listed = isRecord(settings.providerInstances) ? settings.providerInstances : {};
  const configured = Object.entries(listed).flatMap(([id, value]): Instance[] =>
    isRecord(value) && typeof value.driver === 'string' ? [{ ...value, id, driver: value.driver }] : []);
  const builtIn = BUILT_IN_ENABLED.filter((id) => !Object.hasOwn(listed, id)).map((id) => ({ id, driver: id, enabled: true }));
  return [...configured, ...builtIn];
}

function enabled(instance: Instance): boolean {
  const configEnabled = isRecord(instance.config) && typeof instance.config.enabled === 'boolean' ? instance.config.enabled : undefined;
  if (instance.enabled === false || configEnabled === false) return false;
  return typeof instance.enabled === 'boolean' ? instance.enabled : configEnabled ?? !DISABLED_BY_DEFAULT.has(instance.driver);
}

const humanize = (slug: string) => slug.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

/** Its display name unless that's just the driver's; else, off the built-in id, the id made readable. */
function displayName(instance: Instance): string {
  const named = typeof instance.displayName === 'string' ? instance.displayName.trim() : '';
  const driverName = DRIVER_NAMES[instance.driver] ?? humanize(instance.driver);
  if (named && named !== driverName) return named;
  if (instance.id !== instance.driver && humanize(instance.id)) return humanize(instance.id);
  return named || driverName;
}

function currentModels(manifest: Record<string, unknown>, driver: string): ModelOption[] {
  const slugs = isRecord(manifest.currentModels) ? manifest.currentModels[driver] : undefined;
  const provider = isRecord(manifest.providers) ? manifest.providers[driver] : undefined;
  const known = isRecord(provider) && Array.isArray(provider.models) ? provider.models.filter(isRecord) : [];
  return (Array.isArray(slugs) ? slugs : []).filter((slug): slug is string => typeof slug === 'string' && slug.trim() !== '')
    .map((slug) => {
      const name = known.find((m) => m.slug === slug)?.name;
      return { slug, label: typeof name === 'string' && name.trim() ? name : slug };
    });
}

/** The instance's custom models, by slug: T3 takes a slug or `{ slug, name }`. */
function customModels(config: unknown): ModelOption[] {
  const entries = isRecord(config) && Array.isArray(config.customModels) ? config.customModels : [];
  return entries.map((entry) => (isRecord(entry) ? entry.slug : entry))
    .filter((slug): slug is string => typeof slug === 'string' && slug.trim() !== '')
    .map((slug) => ({ slug: slug.trim(), label: slug.trim() }));
}

function uniqueBySlug(models: ModelOption[]): ModelOption[] {
  return models.filter((model, i) => models.findIndex((m) => m.slug === model.slug) === i);
}
