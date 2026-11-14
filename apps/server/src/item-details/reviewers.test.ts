import { openWorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { recordDetails } from './item-details.ts';

test('details expose selected and skipped reviewers with reasons before a round finishes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-display-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const work = records.create({ title: 'Review', repository: 'fake/app', kind: 'bug' });

        records.saveReviewerSelection(work.workId, {
            workId: work.workId,
            base: 'a'.repeat(40),
            head: 'b'.repeat(40),
            reviewers: [
                { id: 'code', name: 'Code', run: true, reason: 'Always reviews every build.' },
                { id: 'security', name: 'Security', run: false, reason: 'No security signals.' },
            ].map((reviewer) => ({
                ...reviewer,
                triggerVersion: 1 as const,
                outcome: reviewer.run ? ('matched' as const) : ('unmatched' as const),
                rule: 'fixture',
                evidence: reviewer.reason,
            })),
        });
        expect(recordDetails(records, work.workId)?.reviewers).toMatchObject([
            { name: 'Code', reason: 'Always reviews every build.', status: 'Waiting' },
            { name: 'Security', reason: 'No security signals.', status: 'Skipped' },
        ]);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('reviewer progress exposes running, failed and completed results as each role finishes', async () => {
    const { reviewerProgress } = await import('./reviewers.ts');
    const selectedAt = '2026-01-01T00:00:00.000Z';
    const roleRuns = [
        { role: 'reviewer:code', startedAt: '2025-12-01', result: 'completed', summary: 'Old result must not leak.' },
        { role: 'reviewer:code', startedAt: '2026-01-01T00:01:00.000Z', result: 'running' },
        {
            role: 'reviewer:security',
            startedAt: '2026-01-01T00:01:00.000Z',
            result: 'completed',
            summary: 'Approve: inputs validated.',
        },
        {
            role: 'reviewer:ui',
            startedAt: '2026-01-01T00:01:00.000Z',
            result: 'failed',
            failure: 'Execution unavailable.',
        },
    ];
    const records = {
        reviewerSelection: () => ({
            selectedAt,
            reviewers: ['code', 'security', 'ui'].map((id) => ({ id, name: id, run: true, reason: `Selected ${id}` })),
        }),
        runSettings: () => ({ roleRuns }),
        reviewRounds: () => [],
    };

    expect(reviewerProgress(records as never, 'work')).toMatchObject([
        { id: 'code', status: 'Running' },
        { id: 'security', status: 'Completed', result: 'Approve: inputs validated.' },
        { id: 'ui', status: 'Failed', result: 'Execution unavailable.' },
    ]);
});
