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

    expect(conceptBuildHoldSummary(plan)).toBe('Waiting on 1 decision and 1 gate');
    expect(plan.holds).toHaveLength(3);
    expect(conceptBuildHoldSummary({ ...plan, holds: [] })).toBe('');
});
