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

test('a ready concept has one group start per surface and its parts retain manual Start build', async () => {
    const concept = sample.items.find((item) => item.kind === 'concept')!;
    const build = sample.items.find((item) => item.kind !== 'concept')!;
    const plan: ConceptBuildPlan = {
        run: null,
        holds: [],
        members: ['build-a', 'build-b', 'build-c'].map((workId) => ({
            workId,
            title: workId,
            repository: 'example/a',
            kind: 'build',
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
    expect([...row.querySelectorAll('button')].some((b) => text(b) === 'Start build')).toBe(true);

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
    await show({
        run: null,
        holds: [{ workId: 'd', reason: 'Its confirmed answer is missing.' }],
        members: [
            {
                workId: 'd',
                kind: 'decision',
                title: 'Choose colour',
                repository: 'fake/app',
                status: 'Shaping',
                waits: [],
                complete: false,
            },
        ],
    });

    const action = $('[data-concept-build-action]')!;

    expect(text(action.querySelector('summary'))).toBe('Waiting on 1 decision');
    expect(action.querySelector('details')?.open).toBe(false);
    await settle(() => action.querySelector('summary')!.click());
    expect(action.querySelector('details')?.open).toBe(true);
    expect(text(action)).toContain('Its confirmed answer is missing.');
});

test.each(['running', 'paused'] as const)('the %s concept header describes the run', async (state) => {
    await show({ run: { state, startedAt: '2026-01-01', prepared: {} }, holds: [], members: [] });

    const header = text($('[data-item-dialog] header'));

    expect(header).toContain(state === 'running' ? 'Concept builds running' : 'Concept builds paused');
    expect(header).not.toContain('No direct agent work yet');
});

test.each(['running', 'paused'] as const)(
    'the %s concept and Ready share occupancy including outside builds',
    async (state) => {
        const concept = sample.items.find((item) => item.kind === 'concept')!;
        const base = sample.items.find((item) => item.kind !== 'concept')!;
        const members = ['a1', 'a2', 'b1'].map((workId) => ({
            workId,
            title: workId,
            repository: 'example/a',
            kind: 'build',
            status: workId === 'a2' ? 'Ready' : 'In progress',
            waits: [],
            complete: false,
        }));
        const data: BoardData = {
            ...sample,
            buildLimit: { limit: 4, automatic: 2 },
            items: [
                {
                    ...concept,
                    conceptBuild: { run: { state, startedAt: '2026-01-01', prepared: {} }, holds: [], members },
                },
                ...[...members, { workId: 'outside', status: 'Review' }, { workId: 'standalone', status: 'Ready' }].map(
                    (member) => ({
                        ...base,
                        id: member.workId,
                        kind: 'build' as const,
                        status: member.status as 'Ready' | 'In progress' | 'Review',
                        buildReserved: member.status !== 'Ready',
                        parentId: ['outside', 'standalone'].includes(member.workId) ? null : concept.id,
                        parent: null,
                        threads: [],
                        blockers: [],
                    }),
                ),
            ],
        };

        holdPosts(data);
        await mountPage(data);
        expect(text($('[data-ready-build-controls]'))).toContain('3 building · limit 4');
        expect($('[data-ready-build-controls]')!.getAttribute('title') ?? '').not.toContain('exceed');

        const { useItemDialogStore } = await import('./ItemDialogStore');

        await settle(() => useItemDialogStore.getState().open(concept.id));
        expect($('[data-item-dialog] [data-shared-build-capacity]')).toBeNull();
    },
);
test('the concept shows active builds, total progress and an explicit capacity wait', async () => {
    const parent = sample.items.find((item) => item.kind === 'concept')!;
    const part = sample.items.find((item) => item.kind !== 'concept')!;
    const parts: Item[] = [
        {
            ...part,
            id: 'running',
            buildReserved: true,
            title: 'Build running',
            kind: 'build',
            status: 'In progress',
            parentId: parent.id,
            recorded: true,
            threads: [],
            blockers: [],
            slices: [],
            completion: { complete: false, reasons: [] },
        },
        {
            ...part,
            id: 'waiting',
            title: 'Build waiting',
            kind: 'build',
            status: 'Ready',
            parentId: parent.id,
            recorded: true,
            threads: [],
            blockers: [],
            slices: [],
            passingBrief: true,
            completion: { complete: false, reasons: [] },
        },
    ];

    await show(
        {
            run: { state: 'running', startedAt: '2026-01-01', prepared: {} },
            holds: [],
            members: parts.map((item) => ({
                workId: item.id,
                title: item.title,
                repository: item.repo,
                kind: item.kind,
                status: item.status,
                waits: [],
                complete: false,
            })),
        },
        parts,
    );
    expect(text($('[data-concept-build-progress]'))).toBe('1 building · 1 waiting · 0/2 complete');
    expect($('[data-concept-build-run]')!.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(text($('[data-concept-parts]'))).toContain('Waiting for shared build capacity.');
});

test.each([
    { auto: true, state: null, waiting: true, label: null },
    { auto: false, state: null, waiting: false, label: null },
    { auto: false, state: null, waiting: true, label: 'Start remaining concept builds' },
    { auto: true, state: 'paused', waiting: true, label: 'Start remaining concept builds' },
    { auto: true, state: 'running', waiting: true, label: 'Pause concept builds' },
] as const)('concept action adds work for %j', async ({ auto, state, waiting, label }) => {
    const parent = sample.items.find((item) => item.kind === 'concept')!;
    const base = sample.items.find((item) => item.kind !== 'concept')!;
    const parts: Item[] = [false, false, ...(waiting ? [true] : [])].map((ready, index) => ({
        ...base,
        id: `part-${index}`,
        title: `Part ${index}`,
        kind: 'build',
        parentId: parent.id,
        parent: null,
        status: ready ? 'Ready' : 'In progress',
        buildReserved: !ready,
        threads: [],
        blockers: [],
    }));
    const data: BoardData = {
        ...sample,
        autoBuild: { on: auto },
        items: [
            {
                ...parent,
                conceptBuild: {
                    run: state ? { state, startedAt: '2026-01-01', prepared: {} } : null,
                    holds: [],
                    members: parts.map((item) => ({
                        workId: item.id,
                        title: item.title,
                        repository: item.repo,
                        kind: item.kind,
                        status: item.status,
                        waits: [],
                        complete: false,
                    })),
                },
            },
            ...parts,
        ],
    };

    holdPosts(data);
    await mountPage(data);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(parent.id));

    const actions = [...$('[data-concept-build-run]')!.querySelectorAll('button')].map(text);

    expect(actions).toEqual(label ? [label] : []);
    expect(text($('[data-concept-build-progress]'))).toContain(`2 building · ${waiting ? 1 : 0} waiting`);

    if (!label) expect($('[data-concept-build-action]')).toBeNull();
});
