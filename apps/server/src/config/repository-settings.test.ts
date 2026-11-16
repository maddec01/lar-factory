import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type TestContext } from 'vite-plus/test';

import { saveOnboarded } from './repository-config.ts';
import { readOnboardedConfigs, readRepositorySetups, changeRepositorySettings } from './repository-settings.ts';

async function folder(t: TestContext) {
    const dir = await mkdtemp(join(tmpdir(), 'local-settings-'));

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

    return dir;
}

test('board reads only local overrides and makes no provider calls', async (t) => {
    const dir = await folder(t);

    await writeFile(
        join(dir, 'repository-settings.json'),
        JSON.stringify({
            repositories: [
                {
                    repo: 'team/app',
                    settings: {
                        overrides: { role: 'Application', skills: ['test'] },
                        shared: { role: 'Old shared role', labels: ['old'] },
                        sharedProblem: 'Old warning',
                        accepted: {
                            itemSource: { kind: 'issues' },
                            domainDocs: { kind: 'repository', glossary: 'OLD.md', adrs: 'old' },
                        },
                    },
                },
            ],
        }),
    );

    let calls = 0;
    const result = await readOnboardedConfigs(
        [{ repo: 'team/app' }],
        async () => {
            calls++;
            throw new Error('No network');
        },
        dir,
    );

    expect(calls).toBe(0);
    expect(result.problems).toEqual([]);
    expect(result.setups[0]).toMatchObject({ role: 'Application', labels: [], skills: ['test'], structureSync: true });
    expect(result.setups[0]).not.toHaveProperty('shared');
    expect(result.setups[0]).not.toHaveProperty('paused');
});

test('local settings validate values and reset to factory defaults', async (t) => {
    const dir = await folder(t);

    saveOnboarded('team/app', null, dir);
    expect(
        await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'role', value: 'App' }, dir),
    ).toMatchObject({ setup: { role: 'App' } });
    expect(await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'role' }, dir)).toMatchObject({
        setup: { role: '' },
    });
    expect(
        await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'skills', value: 'all' }, dir),
    ).toMatchObject({ status: 400 });
    expect(
        await changeRepositorySettings({ repo: 'else/app', change: 'override', key: 'role', value: 'X' }, dir),
    ).toMatchObject({ status: 409 });
    expect(readRepositorySetups(dir)[0]?.role).toBe('');
});

test('a project saves its Build method, TDD unless set, and refuses an unknown one', async (t) => {
    const dir = await folder(t);
    const change = (value?: unknown) =>
        changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'buildMethod', value }, dir);

    saveOnboarded('team/app', null, dir);
    expect(readRepositorySetups(dir)[0]).toMatchObject({ buildMethod: 'tdd', sources: { buildMethod: 'default' } });
    expect(await change('prove-it')).toMatchObject({
        setup: { buildMethod: 'prove-it', sources: { buildMethod: 'local' } },
    });
    expect(await change('waterfall')).toMatchObject({ status: 400 });
    expect(readRepositorySetups(dir)[0]?.buildMethod).toBe('prove-it');
    expect(await change()).toMatchObject({ setup: { buildMethod: 'tdd' } });
});

test('legacy private domain docs read as off and save as on or off', async (t) => {
    const dir = await folder(t);

    await writeFile(
        join(dir, 'repository-settings.json'),
        JSON.stringify({
            repositories: [{ repo: 'team/app', settings: { overrides: { domainDocs: { kind: 'private' } } } }],
        }),
    );
    expect(readRepositorySetups(dir)[0]?.domainDocs).toEqual({ kind: 'off' });
    await changeRepositorySettings(
        { repo: 'team/app', change: 'override', key: 'domainDocs', value: { kind: 'off' } },
        dir,
    );
    expect(await readFile(join(dir, 'repository-settings.json'), 'utf8')).not.toContain('private');
});

test('stale publication settings requests preserve the complete settings file', async (t) => {
    const dir = await folder(t);

    saveOnboarded('team/app', null, dir);

    const path = join(dir, 'repository-settings.json');
    const before = await readFile(path, 'utf8');

    for (const value of [false, true]) {
        expect(
            await changeRepositorySettings({ repo: 'team/app', change: 'structure-sync', value }, dir),
        ).toMatchObject({ status: 400, error: expect.stringContaining('suspended') });
        expect(await readFile(path, 'utf8')).toBe(before);
    }
});

test('vocabulary discovery reads existing terms and saving requires field access', async (t) => {
    const dir = await folder(t);

    saveOnboarded('team/app', null, dir);

    const reads = {
        github: async (path: string) =>
            path === 'repos/team/app' ? { owner: { type: 'Organization' } } : [[{ name: 'bug' }]],
        azure: async () => {
            throw new Error('Unexpected Azure read');
        },
    };
    const before = await readFile(join(dir, 'repository-settings.json'), 'utf8');

    expect(
        await changeRepositorySettings({ repo: 'team/app', change: 'discover-vocabulary' }, dir, reads),
    ).toMatchObject({ discovery: { labels: { state: 'available', choices: ['bug'] } } });
    expect(await readFile(join(dir, 'repository-settings.json'), 'utf8')).toBe(before);
    expect(
        await changeRepositorySettings(
            { repo: 'team/app', change: 'vocabulary', key: 'bug', value: { type: null, labels: ['bug'] } },
            dir,
            reads,
        ),
    ).toMatchObject({ status: 400 });
    expect(
        await changeRepositorySettings(
            { repo: 'team/app', change: 'vocabulary', key: 'bug', value: { type: null, labels: [] } },
            dir,
            reads,
        ),
    ).toMatchObject({ setup: { vocabularySources: { bug: 'local' } } });
});
