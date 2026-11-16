import { expect, test } from 'vite-plus/test';

import { conceptFog } from './concept-fog.ts';

const decision = { id: 'd', kind: 'decision', complete: false, active: false, question: false, decisionMethod: 'task' };

test('only a live owner and route count as an open question', () => {
    const fog = ['Fixture details', '[decision: d] UTC?', '[question: g] Label?', '[factory: d] Fixtures'];

    expect(conceptFog(fog, [decision]).map((f) => f.routed)).toEqual([false, true, false, false]);
    expect(
        conceptFog(fog, [
            { ...decision, active: true },
            { ...decision, id: 'g', kind: 'concept', question: true },
        ]).map((f) => f.routed),
    ).toEqual([false, true, true, true]);
    expect(
        conceptFog(fog, [{ ...decision, complete: true, active: true, question: true }]).every((f) => !f.routed),
    ).toBe(true);
    expect(
        conceptFog(['[factory: g] Fixtures'], [{ ...decision, id: 'g', kind: 'concept', active: true }])[0]?.routed,
    ).toBe(false);
});
