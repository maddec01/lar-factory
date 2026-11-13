// The model choices Start offers, from T3 Code's settings and model list, read-only.
// Only instance ids, display names, model slugs and model names
// leave this file: the settings may hold secrets. Which instances are enabled and
// what they're called follow pingdotgg/t3code main at a68e6e97c501d265e1edccb47b96f8365c8e38f4:
// resolveProviderInstanceEnabled in packages/contracts/src/settings.ts,
// deriveProviderInstanceConfigMap in apps/server/src/provider/ProviderInstanceRegistryHydration.ts
// and resolveProviderInstanceDisplayName in packages/client-runtime/src/state/providerInstanceDisplay.ts.
// The project's effective default follows pingdotgg/t3code main at 97e35bcf23e4dcf34c2dcffadd37c08db0e01e52:
// resolveProjectOverrides in packages/shared/src/projectSettings.ts and
// resolveProjectProviderInstanceEnabled in packages/contracts/src/settings.ts.

import { isRecord, offers } from '@lar-factory/shared';
import type { ModelChoice, ModelGroup, ModelOption, ModelSelection, ModelSelectionOption } from '@lar-factory/shared';

import { readJsonRecord } from '../json-file.ts';
import { manifestEfforts } from './model-efforts.ts';
import { projectDefaultSelection, readT3Db } from './t3-db.ts';
import { statsDbPath, t3SettingsPath } from './t3-settings.ts';

/** Each driver's name in T3 (PROVIDER_DISPLAY_NAMES). */
const DRIVER_NAMES: Record<string, string> = {
    antigravity: 'Antigravity',
    codex: 'Codex',
    claudeAgent: 'Claude',
    cursor: 'Cursor',
    grok: 'Grok',
    muse: 'Muse Code',
    acpRegistry: 'ACP Registry',
    pi: 'Pi',
    opencode: 'OpenCode',
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
 * "T3 Project default" aside, the choices Start offers: each enabled provider instance with its
 * driver's current models in manifest order, then its custom models. Empty when the
 * settings or the model list can't be read.
 */
export function loadModelChoices(settingsPath: string, manifestPath: string): ModelGroup[] {
    const settings = readJsonRecord(settingsPath);
    const manifest = readManifest(manifestPath);

    if (!settings || !manifest) return [];

    return instances(settings)
        .filter(enabled)
        .flatMap((instance) => {
            const models = uniqueBySlug([
                ...currentModels(manifest, instance.driver),
                ...customModels(instance.config, manifest, instance.driver),
            ]);

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

/** What T3 gives a new thread in a project: its default model selection, null when it has none or it can't be read, and its runtime mode. */
export interface ProjectDefaults {
    selection: ModelSelection | null;
    runtimeMode: string;
}

/** T3's DEFAULT_RUNTIME_MODE, for settings that don't name one. */
const DEFAULT_RUNTIME_MODE = 'full-access';

/** The project's defaults from T3's `settings`. `projectRow` reads the database's selection, which T3 ignores once settings are folded. */
export function effectiveDefaults(
    settings: Record<string, unknown>,
    projectId: string,
    projectRow: () => unknown,
): ProjectDefaults {
    const overrides = isRecord(settings.projectSettingsOverrides)
        ? settings.projectSettingsOverrides[projectId]
        : undefined;
    const stored = isRecord(overrides) ? overrides : {};
    const runtimeMode =
        ([stored.defaultRuntimeMode, settings.defaultRuntimeMode].find((mode) => typeof mode === 'string') as
            | string
            | undefined) ?? DEFAULT_RUNTIME_MODE;
    let row: unknown;

    if (settings.projectSettingsFolded !== true && stored.defaultModelSelection === undefined) {
        try {
            row = projectRow();
        } catch {
            return { selection: null, runtimeMode };
        }
    }

    const override = stored.defaultModelSelection === undefined ? (row ?? undefined) : stored.defaultModelSelection;

    // T3 skips an override on an instance disabled here. A null override clears the default.
    if (override === null) return { selection: null, runtimeMode };

    const selection = parseSelection(override);
    const chosen =
        selection && instanceEnabled(settings, stored, selection.instanceId)
            ? selection
            : parseSelection(settings.defaultModelSelection);

    return { selection: chosen, runtimeMode };
}

/** A project's defaults from T3's settings file and database, or null when the settings can't be read. */
export function projectDefaults(
    projectId: string,
    settingsPath = t3SettingsPath(),
    dbPath = statsDbPath(),
): ProjectDefaults | null {
    const settings = readJsonRecord(settingsPath);

    return (
        settings &&
        effectiveDefaults(settings, projectId, () => readT3Db(dbPath, (db) => projectDefaultSelection(db, projectId)))
    );
}

/** What a launch sends for `choice`: the default's options when it names the default's instance and model, else none, as options belong to one model. */
export function launchSelection(choice: ModelChoice, selection: ModelSelection | null): ModelSelection {
    const same = selection?.instanceId === choice.instanceId && selection.model === choice.model;

    return same && selection.options?.length ? { ...choice, options: selection.options } : choice;
}

/** Only the instance, model and option ids and values: the settings may hold secrets. */
function parseSelection(value: unknown): ModelSelection | null {
    if (!isRecord(value) || typeof value.instanceId !== 'string' || typeof value.model !== 'string') return null;

    const options = (Array.isArray(value.options) ? value.options : []).flatMap((option): ModelSelectionOption[] =>
        isRecord(option) &&
        typeof option.id === 'string' &&
        (typeof option.value === 'string' || typeof option.value === 'boolean')
            ? [{ id: option.id, value: option.value }]
            : [],
    );

    return { instanceId: value.instanceId, model: value.model, ...(options.length ? { options } : {}) };
}

/** The project's own switch for an instance, then the settings', then whether it is a built-in one. */
function instanceEnabled(
    settings: Record<string, unknown>,
    stored: Record<string, unknown>,
    instanceId: string,
): boolean {
    const here = isRecord(stored.providerInstances) ? stored.providerInstances[instanceId] : undefined;

    if (isRecord(here) && typeof here.enabled === 'boolean') return here.enabled;

    const listed = instances(settings).find((instance) => instance.id === instanceId);

    return listed ? enabled(listed) : false;
}

/** The manifest inside T3's cached model list, or null when it can't be read. */
function readManifest(path: string): Record<string, unknown> | null {
    const manifest = readJsonRecord(path)?.manifest;

    return isRecord(manifest) ? manifest : null;
}

/** The settings' instances, then each built-in instance they don't list. */
function instances(settings: Record<string, unknown>): Instance[] {
    const listed = isRecord(settings.providerInstances) ? settings.providerInstances : {};
    const configured = Object.entries(listed).flatMap(([id, value]): Instance[] =>
        isRecord(value) && typeof value.driver === 'string' ? [{ ...value, id, driver: value.driver }] : [],
    );
    const builtIn = BUILT_IN_ENABLED.filter((id) => !Object.hasOwn(listed, id)).map((id) => ({
        id,
        driver: id,
        enabled: true,
    }));

    return [...configured, ...builtIn];
}

function enabled(instance: Instance): boolean {
    const configEnabled =
        isRecord(instance.config) && typeof instance.config.enabled === 'boolean' ? instance.config.enabled : undefined;

    if (instance.enabled === false || configEnabled === false) return false;

    return typeof instance.enabled === 'boolean'
        ? instance.enabled
        : (configEnabled ?? !DISABLED_BY_DEFAULT.has(instance.driver));
}

const humanize = (slug: string) =>
    slug
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());

/** Name the provider and its account together; instance ids remain stable launch targets. */
function displayName(instance: Instance): string {
    const named = typeof instance.displayName === 'string' ? instance.displayName.trim() : '';
    const provider = DRIVER_NAMES[instance.driver] ?? humanize(instance.driver);
    const suffix =
        instance.id === instance.driver
            ? ''
            : humanize(instance.id.replace(new RegExp(`^${instance.driver}[_-]?`), ''));
    const account =
        named && named !== provider ? named.replace(new RegExp(`^${provider}[ ·:-]+`, 'i'), '') : suffix || 'Default';

    return `${provider} · ${account}`;
}

/** Resolve manifest aliases before deduplication and retain context variants as distinct choices. */
function modelOption(
    slug: string,
    manifest: Record<string, unknown>,
    driver: string,
    customName?: unknown,
): ModelOption {
    const provider = isRecord(manifest.providers) ? manifest.providers[driver] : undefined;
    const known = isRecord(provider) && Array.isArray(provider.models) ? provider.models.filter(isRecord) : [];
    const context = slug.match(/\[(\d+[mk])\]$/i)?.[1];
    const base = slug.replace(/\[\d+[mk]\]$/i, '');
    const match = known.find((m) => m.slug === base || (Array.isArray(m.aliases) && m.aliases.includes(base)));
    const canonical = typeof match?.slug === 'string' ? match.slug : base;
    const name =
        typeof customName === 'string' && customName.trim() && customName !== slug
            ? customName.trim()
            : typeof match?.name === 'string' && match.name.trim()
              ? match.name
              : humanize(base)
                    .replace(/^Gpt\b/, 'GPT')
                    .replace(/(\d)[ -](\d)/g, '$1.$2');

    const efforts = manifestEfforts(provider, match);

    return {
        ...(efforts.length ? { efforts } : {}),
        slug: canonical + (context ? `[${context.toLowerCase()}]` : ''),
        label: name + (context && !/context/i.test(name) ? ` · ${context.toUpperCase()} context` : ''),
    };
}

function currentModels(manifest: Record<string, unknown>, driver: string): ModelOption[] {
    const slugs = isRecord(manifest.currentModels) ? manifest.currentModels[driver] : undefined;

    return (Array.isArray(slugs) ? slugs : [])
        .filter((slug): slug is string => typeof slug === 'string' && slug.trim() !== '')
        .map((slug) => modelOption(slug, manifest, driver));
}

/** The instance's custom models, by slug: T3 takes a slug or `{ slug, name }`. */
function customModels(config: unknown, manifest: Record<string, unknown>, driver: string): ModelOption[] {
    const entries = isRecord(config) && Array.isArray(config.customModels) ? config.customModels : [];

    return entries.flatMap((entry) => {
        const slug = isRecord(entry) ? entry.slug : entry;

        return typeof slug === 'string' && slug.trim()
            ? [modelOption(slug.trim(), manifest, driver, isRecord(entry) ? entry.name : undefined)]
            : [];
    });
}

function uniqueBySlug(models: ModelOption[]): ModelOption[] {
    return models.filter((model, i) => models.findIndex((m) => m.slug === model.slug) === i);
}
