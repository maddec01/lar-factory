import { expect, test } from 'vite-plus/test';

import { conceptFog, itemFog } from './concept-fog.ts';
import type { Item } from './item-domain.ts';

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

test('recorded completion decides when a board question route expires', () => {
    const parent = {
        id: 'g',
        kind: 'concept',
        threads: [],
        status: 'Shaping',
        map: { destination: '', decisions: [], fog: ['[decision: d] UTC?'] },
    } as unknown as Item;
    const part = {
        id: 'd',
        kind: 'decision',
        parentId: 'g',
        threads: [],
        status: 'Done',
        completion: { complete: false, reasons: ['Answer is not incorporated.'] },
    } as unknown as Item;

    expect(itemFog(parent, [parent, part])[0]?.routed).toBe(true);
    part.completion = { complete: true, reasons: [] };
    expect(itemFog(parent, [parent, part])[0]?.routed).toBe(false);
});
