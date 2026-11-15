import { expect, test } from 'vite-plus/test';

import { conceptBuildHoldSummary, type ConceptBuildPlan } from './concept-build.ts';

test('summarizes unique decisions and gates, retaining every hold for disclosure', () => {
    const plan: ConceptBuildPlan = {
        run: null,
        members: [{ workId: 'decision', kind: 'decision' } as ConceptBuildPlan['members'][number]],
        holds: [
            { workId: 'decision', reason: "Its confirmed answer isn't recorded. Its domain drafts aren't recorded." },
            { workId: 'build', reason: 'Build: the current brief needs an approved gate.' },
            { workId: 'build', reason: 'Build: status is Needs you; finish shaping first.' },
        ],
    };

    expect(conceptBuildHoldSummary(plan)).toBe('Waiting on 1 open decision and 1 approval');
    expect(plan.holds).toHaveLength(3);
    expect(conceptBuildHoldSummary({ ...plan, holds: [] })).toBe('');
});

test('says whether decisions have started and names a Dependency by its project', () => {
    const decision = (workId: string, status: string) =>
        ({ workId, kind: 'decision', status }) as ConceptBuildPlan['members'][number];
    const plan: ConceptBuildPlan = {
        run: null,
        members: [decision('a', 'Queued'), decision('b', 'Queued')],
        holds: [
            { workId: 'a', reason: "Its confirmed answer isn't recorded." },
            { workId: 'b', reason: "Its confirmed answer isn't recorded." },
            { workId: 'c', reason: 'Dependency on maddec01/lar-platform: Export the fixtures so lar-server can test.' },
        ],
    };

    expect(conceptBuildHoldSummary(plan)).toBe('Waiting on 2 decisions not started and a dependency on lar-platform');
});
