// Shared by the server and lar-work. This feature never reads repository configuration or opens the work database.
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { parseFactorySettings, type FactorySettings } from '@lar-factory/shared/factory-settings';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'factory-settings.json';
const BACKUP = 'factory-settings.last-good.json';

function read(path: string): FactorySettings | undefined {
    let content: string;

    try {
        content = readFileSync(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;

        throw error;
    }

    return parseFactorySettings(JSON.parse(content));
}

/** Missing settings upgrade to the former four axes and inheritance. Auto-build's explicit choice stays in auto-build.json. */
export function readFactorySettings(dir = boardDataDir()): { settings: FactorySettings; problem?: string } {
    try {
        const settings = read(join(dir, FILE));

        if (settings) return { settings };

        const previous = read(join(dir, BACKUP));

        return previous
            ? { settings: previous, problem: `Missing ${join(dir, FILE)}; using the last good factory settings.` }
            : { settings: parseFactorySettings(undefined) };
    } catch (error) {
        // Corruption never silently changes a saved policy to defaults, including after a process restart.
        const previous = read(join(dir, BACKUP));

        if (!previous)
            throw new Error(`Cannot read factory settings in ${dir}; no last good settings are available.`, {
                cause: error,
            });

        return { settings: previous, problem: `Cannot read ${join(dir, FILE)}; using the last good factory settings.` };
    }
}

function atomicWrite(path: string, settings: FactorySettings): void {
    const temporary = `${path}.${randomUUID()}.tmp`;

    try {
        writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        renameSync(temporary, path);
    } finally {
        rmSync(temporary, { force: true });
    }
}

/** Validate the entire draft before any write. Existing instruction revisions cannot be rewritten or discarded. */
export function writeFactorySettings(value: unknown, dir = boardDataDir()): FactorySettings {
    if (value === undefined) throw new Error('Factory settings are required.');

    const next = parseFactorySettings(value);
    const previous = readFactorySettings(dir).settings;

    for (const old of previous.reviewers) {
        const reviewer = next.reviewers.find((entry) => entry.id === old.id);

        if (old.revisions.some((entry, index) => reviewer?.revisions[index]?.text !== entry.text)) {
            throw new Error(`Keep instruction revisions for reviewer ${old.id}; use never mode to disable it.`);
        }
    }
    mkdirSync(dir, { recursive: true });
    // Keep a durable validated copy, including on the first save and across process restarts.
    atomicWrite(join(dir, BACKUP), next);
    atomicWrite(join(dir, FILE), next);

    return next;
}
