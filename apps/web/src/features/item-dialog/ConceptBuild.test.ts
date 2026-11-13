import type { BoardData, ConceptBuildPlan } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, holdPosts, mountPage, posted, sample, settle, text } from '@/test/PageTest';

async function show(plan: ConceptBuildPlan) {
    const concept = sample.items.find((item) => item.kind === 'concept')!;
    const data: BoardData = {
        ...sample,
        capture: { session: 's1', enabled: true },
        items: sample.items.map((item) =>
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

test('shows every hold and disables Start concept builds', async () => {
    await show({
        run: null,
        holds: [
            { workId: 'd', reason: 'Decision remains open.' },
            { workId: 'p', reason: 'Pre-task remains open.' },
        ],
        members: [],
    });
    expect(text($('[data-concept-build-run]')!)).toContain('Decision remains open.');
    expect(text($('[data-concept-build-run]')!)).toContain('Pre-task remains open.');
    expect(button().disabled).toBe(true);
    expect(text(button())).toBe('Start concept builds');
});

test.each(['running', 'paused'] as const)(
    'the %s run posts the displayed revision and exact opposite action',
    async (state) => {
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
    },
);

test('a ready concept has one start per surface and its footer never starts an ordinary build', async () => {
    const concept = sample.items.find((item) => item.kind === 'concept')!;
    const build = sample.items.find((item) => item.kind !== 'concept')!;
    const plan: ConceptBuildPlan = {
        run: null,
        holds: [],
        members: ['build-a', 'build-b', 'build-c'].map((workId) => ({
            workId,
            status: 'Ready',
            waits: [],
            complete: false,
        })),
    };
    const data: BoardData = {
        ...sample,
        items: [
            {
                ...concept,
                status: 'Ready',
                threads: [],
                conceptBuild: plan,
                completion: { complete: false, reasons: ["Its build isn't Done."] },
            },
            ...plan.members.map(({ workId: id }) => ({
                ...build,
                id,
                kind: 'build' as const,
                status: 'Ready' as const,
                parentId: concept.id,
                parent: null,
                blockers: [],
                threads: [],
                stats: undefined,
            })),
        ],
    };

    holdPosts(data);
    await mountPage(data);

    const row = $(`[data-dossier="${concept.id}"]`)!;

    await settle(() => row.querySelector<HTMLButtonElement>('[data-dossier-open]')!.click());
    expect([...row.querySelectorAll('button')].filter((b) => text(b) === 'Start concept builds')).toHaveLength(1);
    expect([...row.querySelectorAll('button')].some((b) => text(b) === 'Start build')).toBe(false);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(concept.id));

    const dialog = $('[data-item-dialog]')!;

    expect(text(dialog)).toContain('0 of 3 builds done');
    expect(text(dialog)).not.toContain("Its build isn't Done.");
    expect(text(dialog)).not.toContain('With parts');
    expect([...dialog.querySelectorAll('button')].filter((b) => text(b) === 'Start concept builds')).toHaveLength(1);
    expect(text(dialog.querySelector('[data-slot="modal-footer"]'))).not.toContain('Start build');
});

test('compact disabled starts show their hold next to the action', async () => {
    await show({ run: null, holds: [{ workId: 'd', reason: '1 decision open' }], members: [] });

    const action = $('[data-concept-build-action]')!;

    expect(text(action.querySelector('[data-concept-build-hold]'))).toBe('1 decision open');
});

test.each(['running', 'paused'] as const)('the %s concept header describes the run', async (state) => {
    await show({ run: { state, startedAt: '2026-01-01', prepared: {} }, holds: [], members: [] });

    const header = text($('[data-item-dialog] header'));

    expect(header).toContain(state === 'running' ? 'Concept builds running' : 'Concept builds paused');
    expect(header).not.toContain('No direct agent work yet');
});
