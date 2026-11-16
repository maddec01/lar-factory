import { expect, test } from 'vite-plus/test';

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
