import { openWorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, vi } from 'vite-plus/test';

import { statsDb, tempDir } from '../../test/stats-db.ts';
import { createThreadOwnerDiscovery } from './thread-owners.ts';

for (const intent of [false, true])
    test(`direct skill launch registers a durable shaping owner${intent ? ' and resolves its intent' : ''}`, async (t) => {
        const path = join(tempDir(t, 'thread-owner-'), 'records.db');
        let records = await openWorkRecords(path);
        const work = records.create({ title: 'D1', repository: 'fake/project', kind: 'decision', status: 'Queued' });
        const other = records.create({ title: 'Other', repository: 'fake/project', kind: 'decision' });

        if (intent) {
            vi.useFakeTimers({ now: new Date('2026-10-19T00:00:00Z') });

            try {
                records.recordLaunchIntent(work.workId, work.revision, 'shape');
            } finally {
                vi.useRealTimers();
            }
        }

        const t3 = statsDb(t, [
            {
                id: 'skill',
                messages: [
                    intent
                        ? `Shaping D1\nShape ${work.workId}. Read the skill.\nParent ${other.workId}`
                        : `/lar-shape ${work.workId}\nParent ${other.workId}`,
                ],
                title: 'D1 exchange contract',
            },
            { id: 'child', rootThreadId: 'skill', messages: [`/lar-shape ${work.workId}`] },
            { id: 'deleted', deletedAt: '2026-11-13T10:00:00Z', messages: [`/lar-shape ${work.workId}`] },
            { id: 'mention', messages: [`Read the answer in ${other.workId}`] },
            { id: 'later', messages: ['Unrelated task', `/lar-shape ${other.workId}`] },
            { id: 'unknown', messages: ['/lar-shape 00000000-0000-0000-0000-000000000000'] },
        ]);
        const discover = createThreadOwnerDiscovery(t3);

        t.onTestFinished(discover.close);

        const items = [{ id: work.workId }, { id: other.workId }];

        discover(records, items);

        const revision = records.read(work.workId).revision;

        discover(records, items);
        assert.equal(records.read(work.workId).revision, revision, 'refresh is idempotent');
        assert.deepEqual(
            records.threads(work.workId).map(({ threadId, purpose }) => ({ threadId, purpose })),
            [{ threadId: 'skill', purpose: 'shape' }],
        );
        assert.deepEqual(records.threads(other.workId), [], 'brief mentions and later messages claim nothing');

        if (intent) {
            assert.equal(records.launchIntents({ workId: work.workId })[0]?.outcome, 'started');
            assert.equal(records.read(work.workId).status, 'Shaping');
        }

        const external = new DatabaseSync(t3);

        try {
            external
                .prepare('INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?)')
                .run('new-owner', 'New owner', null, JSON.stringify({ lineage: { relationshipToParent: null } }));
            external
                .prepare('INSERT INTO orchestration_v2_projection_messages VALUES (?, ?, ?, ?, ?)')
                .run(
                    'new-message',
                    'new-owner',
                    'user',
                    '2026-11-13T10:00:00Z',
                    JSON.stringify({ text: `/lar-shape ${other.workId}` }),
                );
        } finally {
            external.close();
        }

        discover(records, items);
        assert.equal(
            records.threads(other.workId)[0]?.threadId,
            'new-owner',
            'a launch while the board is open invalidates the cached read',
        );

        records.close();
        records = await openWorkRecords(path);

        try {
            createThreadOwnerDiscovery('/missing/t3.db')(records, items);
            assert.equal(records.threads(work.workId)[0]?.threadId, 'skill', 'restart and T3 outage retain the owner');
        } finally {
            records.close();
        }
    });

test('build launch discovery keeps its stage separate from shaping', async (t) => {
    const records = await openWorkRecords(join(tempDir(t, 'build-owner-'), 'records.db'));

    try {
        const work = records.create({ title: 'Build', repository: 'fake/project', kind: 'build' });

        const discover = createThreadOwnerDiscovery(
            statsDb(t, [{ id: 'build', messages: [`Build Build\nBuild ${work.workId}. Read the builder.`] }]),
        );

        t.onTestFinished(discover.close);
        discover(records, [{ id: work.workId }]);
        assert.equal(records.threads(work.workId)[0]?.purpose, 'build');
    } finally {
        records.close();
    }
});

test('discovery leaves a configured board launch to execution verification', async (t) => {
    const records = await openWorkRecords(join(tempDir(t, 'configured-owner-'), 'records.db'));

    try {
        const work = records.create({ title: 'D1', repository: 'fake/project', kind: 'decision', status: 'Queued' });
        const run = records.snapshotRun(work.workId, work.revision, {
            runId: 'configured-run',
            kind: 'decision',
            projectDefault: { instanceId: 'codex', model: 'configured' },
            skills: [],
            packaged: {
                version: 'fixture',
                reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
            },
        });

        vi.useFakeTimers({ now: new Date('2026-10-19T00:00:00Z') });

        const { intent, record } = records.recordLaunchIntent(work.workId, records.read(work.workId).revision, 'shape');

        vi.useRealTimers();
        records.startRoleRun(work.workId, record.revision, {
            runId: run.runId,
            executionId: intent.intentId,
            role: 'thread',
        });

        const discover = createThreadOwnerDiscovery(
            statsDb(t, [{ id: 'configured', messages: [`Shape ${work.workId}. Read the skill.`] }]),
        );

        t.onTestFinished(discover.close);
        discover(records, [{ id: work.workId }]);
        assert.equal(records.launchIntents({ unresolved: true })[0]?.intentId, intent.intentId);
        assert.deepEqual(records.threads(work.workId), [], 'the verifier must still find this unregistered thread');
        assert.equal(records.read(work.workId).status, 'Queued');

        records.finishRoleRun(work.workId, records.read(work.workId).revision, {
            executionId: intent.intentId,
            result: 'failed',
            report: null,
            failure: 'T3 did not report the launched model and options.',
        });
        discover(records, [{ id: work.workId }]);
        assert.equal(records.launchIntents({ unresolved: true }).length, 0);
        assert.equal(records.threads(work.workId)[0]?.threadId, 'configured');
        assert.equal(records.read(work.workId).status, 'Shaping');
        assert.equal(records.runSettings(work.workId).roleRuns[0]?.result, 'failed');
    } finally {
        vi.useRealTimers();
        records.close();
    }
});
