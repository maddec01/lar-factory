import { type Item } from '@lar-factory/shared';
import { defaultFactorySettings, FACTORY_ROLES, THREAD_KINDS } from '@lar-factory/shared/factory-settings';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { writeFactorySettings } from '@lar-factory/work-records/factory-settings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { prepareRunLaunch, type RunLaunchDeps } from './run-launch.ts';

const opened: { records: WorkRecords; dir: string }[] = [];
const context = {
    dataDir: '/fixture',
    bin: '/fixture/bin',
    shapeSkill: '/fixture/lar-shape/SKILL.md',
    buildSkill: '/fixture/lar-build/SKILL.md',
};
const project = { instanceId: 'codex', model: 'sol', options: [{ id: 'reasoningEffort', value: 'high' }] };
const packaged = {
    version: 'fixture-1',
    reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
};
const dependencies = (): RunLaunchDeps => ({
    defaults: () => ({ selection: project, runtimeMode: 'full-access' }),
    models: async () => [
        { instanceId: 'codex', model: 'sol', options: [{ id: 'reasoningEffort', values: ['low', 'high'] }] },
        { instanceId: 'claude', model: 'opus', options: [{ id: 'effort', values: ['low', 'high'] }] },
    ],
    packaged: () => packaged,
    release: () => undefined,
});

async function fixture(kind: string = 'issue') {
    const dir = mkdtempSync(join(tmpdir(), 'p50-run-launch-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));
    const work = records.create({ title: 'Configured run', repository: 'example/repo', kind: kind as 'issue' });
    const item = { id: work.workId, kind } as Item;

    opened.push({ records, dir });

    return { dir, records, item };
}

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

for (const kind of THREAD_KINDS.filter((threadKind): boolean => threadKind === 'build'))
    it(`launches ${kind} with its frozen kind target and every role`, async () => {
        const { records, dir, item } = await fixture(kind === 'shaping' ? 'issue' : kind);
        const settings = defaultFactorySettings();

        settings.threadKinds[kind] = { model: { instanceId: 'claude', model: 'opus' }, effort: 'low' };
        settings.roles['reviewer:code'] = { model: { instanceId: 'codex', model: 'sol' }, effort: 'high' };
        settings.roles.doubt = { effort: 'high' };
        writeFactorySettings(settings, dir);

        const result = await prepareRunLaunch(
            records,
            item,
            kind === 'build',
            'project',
            undefined,
            context,
            '/skill',
            () => ['testing'],
            dependencies(),
        );

        expect(result.selection).toEqual({
            instanceId: 'claude',
            model: 'opus',
            options: [{ id: 'effort', value: 'low' }],
        });
        expect(result.snapshot.kind).toBe(kind);

        if (kind === 'build')
            expect(result.snapshot).toMatchObject({
                testRuntime: { node: process.execPath, version: process.version },
            });

        expect(result.snapshot.roles['reviewer:code']).toMatchObject({
            model: { instanceId: 'codex', model: 'sol' },
            effort: 'high',
        });
        for (const role of FACTORY_ROLES)
            expect(result.snapshot.roles[role]).toMatchObject({
                model: { instanceId: 'claude', model: 'opus' },
                effort: role === 'doubt' ? 'high' : 'low',
            });
        expect(result.message).toContain(JSON.stringify(result.snapshot.roles));
        expect(result.message).toContain('delegate_task');
        expect(result.message).toContain(result.snapshot.runId);

        settings.threadKinds[kind] = { effort: 'high' };
        writeFactorySettings(settings, dir);

        const changedDeps = {
            ...dependencies(),
            packaged: vi.fn(() => {
                throw Error('must not reread package');
            }),
        };
        const retry = await prepareRunLaunch(
            records,
            item,
            kind === 'build',
            'project',
            project,
            context,
            '/changed',
            () => {
                throw Error('must not reread skills');
            },
            changedDeps,
        );

        expect(retry).toEqual(result);
        expect(changedDeps.packaged).not.toHaveBeenCalled();
    });

it('freezes the running release in a new run, and none without one', async () => {
    const launch = async (release: string | undefined) => {
        const { records, item } = await fixture('build');

        return prepareRunLaunch(records, item, true, 'project', undefined, context, '/skill', () => [], {
            ...dependencies(),
            release: () => release,
        });
    };

    expect((await launch('2.0.0')).snapshot.release).toBe('2.0.0');
    expect((await launch(undefined)).snapshot).not.toHaveProperty('release');
});
