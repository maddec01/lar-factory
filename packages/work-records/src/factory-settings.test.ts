import {
    defaultFactorySettings,
    duplicateReviewer,
    reviseReviewerInstructions,
} from '@lar-factory/shared/factory-settings';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { readAutoBuild } from './auto-build.ts';
import { readFactorySettings, writeFactorySettings } from './factory-settings.ts';

const dirs: string[] = [];

function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'lar-factory-settings-'));

    dirs.push(dir);

    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('upgrades missing settings without writing on read or changing Auto-build, repository settings or historical reviews', () => {
    const dir = tempDir();
    const existing = {
        'auto-build.json': JSON.stringify({ on: true, model: { instanceId: 'claudeAgent', model: 'explicit-choice' } }),
        'repository-settings.json': '{"repositories":[]}',
        'work-records.db': 'Existing review history is not opened or rewritten by settings.',
    };

    for (const [file, text] of Object.entries(existing)) writeFileSync(join(dir, file), text);
    expect(readFactorySettings(dir)).toEqual({ settings: defaultFactorySettings() });
    expect(readdirSync(dir).sort()).toEqual(Object.keys(existing).sort());
    writeFactorySettings(readFactorySettings(dir).settings, dir);
    for (const [file, text] of Object.entries(existing)) expect(readFileSync(join(dir, file), 'utf8')).toBe(text);
    expect(readAutoBuild(dir)).toEqual({ on: true, model: { instanceId: 'claudeAgent', model: 'explicit-choice' } });
});

it('invalid writes and instruction-history rewrites preserve both saved files', () => {
    const dir = tempDir();
    const settings = duplicateReviewer(defaultFactorySettings(), 'code', 'code-copy', 'Original saved instructions.');

    writeFactorySettings(settings, dir);

    const before = readdirSync(dir).map((file) => [file, readFileSync(join(dir, file), 'utf8')]);
    const rewritten = structuredClone(settings);

    rewritten.reviewers.find((entry) => entry.id === 'code-copy')!.revisions![0]!.text = 'Rewritten past';
    for (const invalid of [undefined, { version: 9 }, rewritten])
        expect(() => writeFactorySettings(invalid, dir)).toThrow(
            /Factory settings are required|Invalid factory settings|Keep instruction revisions/,
        );
    for (const [file, text] of before) expect(readFileSync(join(dir, file!), 'utf8')).toBe(text);
    expect(readFactorySettings(dir).settings).toEqual(settings);

    const edited = reviseReviewerInstructions(settings, 'code-copy', 'Next revision.');

    writeFactorySettings(edited, dir);
    expect(readFactorySettings(dir).settings).toEqual(edited);
});

it('recovers the last valid settings after malformed JSON or an invalid schema, with an explicit problem', () => {
    const dir = tempDir();
    const settings = defaultFactorySettings();

    settings.threadKinds.build = { effort: 'high' };
    writeFactorySettings(settings, dir);
    for (const corrupt of ['{', '{"version":99}', '{"version":1,"roles":{"planner":{"effort":false}}}']) {
        writeFileSync(join(dir, 'factory-settings.json'), corrupt);
        expect(readFactorySettings(dir)).toEqual({ settings, problem: expect.stringContaining('last good') });
    }
    rmSync(join(dir, 'factory-settings.json'));
    expect(readFactorySettings(dir)).toEqual({ settings, problem: expect.stringContaining('last good') });
    writeFactorySettings(settings, dir);
    expect(readFactorySettings(dir)).toEqual({ settings });
});

it('reads legacy built-in edits as custom copies and persists the migration on Save', () => {
    const dir = tempDir();
    const legacy = {
        version: 1,
        reviewers: [
            {
                id: 'code',
                name: 'Code',
                mode: { kind: 'always' },
                instructions: { kind: 'revision', revision: 1 },
                revisions: [{ revision: 1, text: 'Saved before packaged reviewers became read-only.' }],
            },
        ],
    };
    const file = join(dir, 'factory-settings.json');

    writeFileSync(file, JSON.stringify(legacy));

    const migrated = readFactorySettings(dir).settings;

    expect(migrated.version).toBe(2);
    expect(migrated.reviewers.find((entry) => entry.id === 'custom-code-copy')?.revisions).toEqual(
        legacy.reviewers[0]!.revisions,
    );
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(legacy);
    writeFactorySettings(migrated, dir);
    expect(readFactorySettings(dir).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2);
});
