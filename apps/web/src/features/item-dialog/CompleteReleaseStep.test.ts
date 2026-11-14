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
