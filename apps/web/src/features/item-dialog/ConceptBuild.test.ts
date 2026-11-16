import type { BoardData, ConceptBuildPlan, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, holdPosts, mountPage, posted, sample, settle, text } from '@/test/PageTest';

async function show(plan: ConceptBuildPlan, parts: Item[] = []) {
    const concept = sample.items.find((item) => item.kind === 'concept')!;
    const data: BoardData = {
        ...sample,
        capture: { session: 's1', enabled: true },
        items: [...sample.items, ...parts].map((item) =>
            item.id === concept.id ? { ...item, revision: 7, conceptBuild: plan } : item,
        ),
    };

    holdPosts(data);
    await mountPage(data);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(concept.id));

    return concept.id;
}

const button = () => $<HTMLButtonElement>('[data-concept-build-run] button')!;

test.each(['running'] as const)('the %s run posts the displayed revision and exact opposite action', async (state) => {
    const id = await show({ run: { state, startedAt: '2026-01-01', prepared: {} }, holds: [], members: [] });

    expect(text(button())).toBe(state === 'running' ? 'Pause concept builds' : 'Start concept builds');
    await settle(() => button().click());
    expect(posted()).toContainEqual([
        '/api/concept-build-run',
        {
            session: 's1',
            itemId: id,
            revision: 7,
            state: state === 'running' ? 'paused' : 'running',
        },
    ]);
});
