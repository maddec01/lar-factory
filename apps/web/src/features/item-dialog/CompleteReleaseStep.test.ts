import { expect, test } from 'vite-plus/test';

import { fetchMock, fresh, mountPage, posted, sample, settle, text } from '@/test/PageTest';

const parent = {
    ...sample.items[0]!,
    id: 'release-parent',
    kind: 'concept' as const,
    flow: 'linked' as const,
    number: 0,
    status: 'In progress' as const,
    threads: [],
    linkedPrs: [],
    parentId: null,
    parent: null,
    revision: 12,
    releasePlan: {
        steps: [{ id: 'activate', who: 'Pedro', what: 'Activate the approved manifest', done: null }],
        outcomeCheck: { what: 'Check composition', result: 'pending' as const, evidence: null },
    },
};

test('the release desk action opens evidence entry and submits the exact step and parent revision', async () => {
    const board = fresh({ ...sample, items: [parent] });

    fetchMock.mockImplementation(
        async (url: string) =>
            new Response(
                JSON.stringify(
                    url === '/api/complete-release-step'
                        ? { error: 'The parent changed. Read its release steps again.' }
                        : board,
                ),
            ),
    );
    await mountPage(board);

    const action = [...document.querySelectorAll<HTMLButtonElement>('.desk button')].find(
        (button) => button.textContent === 'Mark release step done',
    )!;

    expect(action).toBeTruthy();
    action.click();
    await settle();

    const form = document.querySelector('[data-release-step-form]')!;
    const button = form.querySelector('button')!;

    expect(button.disabled).toBe(true);

    const input = form.querySelector('input')!;

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Manifest activated.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    button.click();
    await settle();
    expect(posted().at(-1)).toEqual([
        '/api/complete-release-step',
        {
            itemId: parent.id,
            revision: 12,
            stepId: 'activate',
            evidence: 'Manifest activated.',
        },
    ]);
    expect(text(form)).toContain('The parent changed. Read its release steps again.');
});

test('a release-step board approval displays its actor, timestamp and exact evidence after success', async () => {
    const at = '2026-11-14T12:00:00Z';
    const after = fresh({
        ...sample,
        items: [
            {
                ...parent,
                revision: 13,
                releasePlan: {
                    ...parent.releasePlan,
                    steps: [
                        {
                            ...parent.releasePlan.steps[0]!,
                            done: { by: 'Pedro', at, evidence: 'Approved manifest 123.' },
                        },
                    ],
                },
            },
        ],
    });
    const board = fresh({ ...sample, items: [parent] });

    fetchMock.mockImplementation(
        async (url: string) =>
            new Response(JSON.stringify(url === '/api/complete-release-step' ? { board: after, error: null } : board)),
    );
    await mountPage(board);

    const action = [...document.querySelectorAll<HTMLButtonElement>('.desk button')].find(
        (button) => button.textContent === 'Mark release step done',
    )!;

    await settle(() => action.click());

    const form = document.querySelector('[data-release-step-form]')!;
    const input = form.querySelector('input')!;

    await settle(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            input,
            'Approved manifest 123.',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(() => form.querySelector('button')!.click());

    const dialog = document.querySelector('[data-item-dialog]')!;

    expect(dialog.querySelector('[data-release-step-form]')).toBeNull();
    expect(text(dialog)).toContain('Pedro · Done');
    expect(text(dialog)).toContain('Approved manifest 123.');
    expect(dialog.querySelector(`time[datetime="${at}"]`)).not.toBeNull();
});

test('an Outcome without an agent owner reaches the desk and records evidence through a board button', async () => {
    const item = {
        ...parent,
        releasePlan: { ...parent.releasePlan, steps: [] },
        outcomeCheck: { ready: true, digest: 'composition-1', run: null },
    };
    const board = fresh({ ...sample, items: [item] });

    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ ...board, error: 'The delivered composition changed.' })),
    );
    await mountPage(board);

    const action = [...document.querySelectorAll<HTMLButtonElement>('.desk button')].find(
        (button) => button.textContent === 'Record Outcome',
    );

    expect(action).toBeTruthy();
    await settle(() => action!.click());

    const form = document.querySelector('[data-outcome-form]')!;

    expect(form).not.toBeNull();

    const dialog = document.querySelector('[data-item-dialog]')!;
    const criterion = item.releasePlan.outcomeCheck.what;

    expect(text(dialog).split(criterion)).toHaveLength(2);
    expect(form.closest('[data-outcome-check]')).not.toBeNull();
    expect(text(dialog.querySelector('[aria-label="What\'s left"]'))).toBe('Outcome check pending');

    const input = form.querySelector('input')!;

    await settle(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            input,
            'Merged A+B composition passed.',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(() =>
        [...form.querySelectorAll('button')].find((button) => button.textContent === 'Outcome passed')!.click(),
    );
    expect(posted().at(-1)).toEqual([
        '/api/record-outcome-check',
        {
            itemId: item.id,
            revision: 12,
            inputDigest: 'composition-1',
            result: 'passed',
            evidence: 'Merged A+B composition passed.',
        },
    ]);
    expect(text(form)).toContain('The delivered composition changed.');
});

test('failed composition offers a fix proposal with evidence and no replacement-pass form', async () => {
    const item = {
        ...parent,
        releasePlan: {
            steps: [],
            outcomeCheck: {
                what: 'A factory → B consumer → C display composition',
                result: 'failed' as const,
                evidence: {
                    by: 'Outcome owner',
                    at: '2026-11-14T15:02:18Z',
                    evidence: 'C has no B→C accepted-text input.',
                },
            },
        },
        outcomeCheck: { ready: true, digest: 'failed-composition', run: null },
    };
    const board = fresh({ ...sample, items: [item] });

    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ ...board, error: 'Lost response; retry uses the same request.' })),
    );
    await mountPage(board);

    const actions = [...document.querySelectorAll<HTMLButtonElement>('.desk button')].filter(
        (b) => b.textContent === 'Propose fix part',
    );

    expect(actions).toHaveLength(1);
    await settle(() => actions[0]!.click());

    const dialog = document.querySelector('[data-item-dialog]')!;

    expect(text(dialog)).toContain('C has no B→C accepted-text input.');
    expect(dialog.querySelector('[data-outcome-form]')).toBeNull();

    const fix = dialog.querySelector('[data-outcome-fix]')!;

    expect(text(fix)).toContain('Doubt');
    await settle(() => fix.querySelector('button')!.click());
    expect(posted().at(-1)).toEqual([
        '/api/propose-outcome-fix',
        { itemId: item.id, revision: 12, inputDigest: 'failed-composition' },
    ]);
    expect(text(fix)).toContain('Lost response');
});
