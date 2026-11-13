import type { Item, ItemDetails } from '@lar-factory/shared';
import { defaultFactorySettings } from '@lar-factory/shared/factory-settings';
import { openWorkRecords, workRecordsPath } from '@lar-factory/work-records';
import { writeFactorySettings } from '@lar-factory/work-records/factory-settings';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { tempDir } from '../../test/stats-db.ts';
import { createItemDetails } from './item-details.ts';

test('item details expose frozen run choices and migrated custom instructions after Settings changes', async (t) => {
    const dir = tempDir(t, 'lar-settings-details-');
    const records = await openWorkRecords(workRecordsPath(dir));

    t.onTestFinished(() => records.close());
    writeFileSync(
        join(dir, 'factory-settings.json'),
        JSON.stringify({
            version: 1,
            reviewers: [
                {
                    id: 'code',
                    name: 'Code',
                    mode: { kind: 'always' },
                    instructions: { kind: 'revision', revision: 1 },
                    revisions: [{ revision: 1, text: 'Saved custom edit.' }],
                },
            ],
        }),
    );

    const work = records.create({ title: 'Run choices', repository: 'test/repo', kind: 'build' });

    records.snapshotRun(work.workId, work.revision, {
        runId: 'run-1',
        kind: 'build',
        skills: [],
        projectDefault: {
            instanceId: 'codex',
            model: 'saved-model',
            options: [{ id: 'reasoningEffort', value: 'high' }],
        },
        packaged: {
            version: 'test-package',
            reviewers: { code: 'Packaged code.', security: 'Security.', ui: 'UI.', performance: 'Performance.' },
        },
    });

    const changed = defaultFactorySettings();

    changed.threadKinds.build = { effort: 'low' };
    writeFactorySettings(changed, dir);

    const item = {
        id: work.workId,
        content: 'ticket',
        kind: 'build',
        parentId: null,
        repo: 'test/repo',
        number: 0,
    } as Item;
    const details = (await createItemDetails(null, () => undefined, { records }).details(item)) as ItemDetails;
    const run = details.record!.runSettings![0]!;

    expect(run.thread).toEqual({ model: { instanceId: 'codex', model: 'saved-model' }, effort: 'high' });
    expect(run.roles.find((r) => r.role === 'planner')?.effort).toBe('high');
    expect(run.reviewers.find((r) => r.id === 'code')).toMatchObject({
        mode: 'never',
        instructions: 'Packaged test-package',
    });
    expect(run.reviewers.find((r) => r.id === 'custom-code-copy')).toMatchObject({
        mode: 'always',
        instructions: 'Custom revision 1',
    });
    expect(JSON.stringify(run)).not.toContain('Saved custom edit.');
});
