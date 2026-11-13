import { defaultFactorySettings, duplicateReviewer } from '@lar-factory/shared/factory-settings';
import { readFactorySettings } from '@lar-factory/work-records/factory-settings';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { tempDir } from '../../test/stats-db.ts';
import { factorySettingsService } from './factory-settings.ts';

function service(t: Parameters<typeof tempDir>[0]) {
    const dir = tempDir(t, 'lar-settings-api-');
    const agents = join(dir, 'lar-build', 'agents');

    mkdirSync(agents, { recursive: true });
    for (const id of ['code', 'security', 'ui', 'performance'])
        writeFileSync(join(agents, `reviewer-${id}.md`), `Default ${id}`);

    return { dir, api: factorySettingsService(dir, dir) };
}

test('defaults, custom instruction copies, and removal survive reopening', (t) => {
    const { dir, api } = service(t);
    let state = api.read([]);

    expect(state.settings).toEqual(defaultFactorySettings());
    expect(state.defaults.code).toBe('Default code');

    let settings = duplicateReviewer(state.settings, 'code', 'code-copy', 'Check edge cases.');

    settings.reviewers.push({
        id: 'docs',
        name: 'Docs',
        mode: { kind: 'always' },
        instructions: { kind: 'revision', revision: 1 },
        revisions: [{ revision: 1, text: 'Check examples.' }],
    });
    settings.roles['reviewer:docs'] = { effort: 'high' };
    expect(api.save({ settings, revision: state.revision }).status).toBe(200);
    state = api.read([]);
    settings = structuredClone(state.settings);
    settings.reviewers = settings.reviewers.filter((entry) => entry.id !== 'docs');
    delete settings.roles['reviewer:docs'];
    expect(api.save({ settings, revision: state.revision }).status).toBe(200);
    expect(readFactorySettings(dir).settings).toEqual(settings);
    expect(settings.reviewers.find((entry) => entry.id === 'code-copy')!.revisions).toEqual([
        { revision: 1, text: 'Check edge cases.' },
    ]);
});

test('invalid, history-rewriting, and stale saves leave saved choices intact', (t) => {
    const { api } = service(t);
    const first = api.read([]);

    expect(api.save({ revision: first.revision, settings: { version: 9 } }).status).toBe(400);

    const settings = duplicateReviewer(first.settings, 'code', 'code-copy', 'First revision.');

    expect(api.save({ revision: first.revision, settings }).status).toBe(200);
    expect(api.save({ revision: first.revision, settings: first.settings }).status).toBe(409);

    const state = api.read([]);

    const rewritten = structuredClone(state.settings);

    rewritten.reviewers.find((entry) => entry.id === 'code-copy')!.revisions![0]!.text = 'Rewrite';
    expect(api.save({ revision: state.revision, settings: rewritten }).status).toBe(400);
    expect(api.read([]).settings).toEqual(settings);
});
