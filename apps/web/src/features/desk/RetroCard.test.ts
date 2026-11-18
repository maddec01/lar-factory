import type { Retro } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import {
    $,
    answer,
    fetchMock,
    fresh,
    holdPosts,
    mountPage,
    posted,
    sample,
    settle,
    text,
    toast,
} from '@/test/PageTest';

const retro: Retro = {
    pr: 'owner/repo#8',
    suggestions: Array.from({ length: 6 }, (_, index) => ({
        title: `Follow-up ${index + 1}`,
        description: `Full description ${index + 1}.`,
        repository: 'owner/repo',
        kind: 'improvement',
    })),
    captures: Array.from({ length: 6 }, () => ({
        requestId: 'capture',
        ticketRequestId: 'ticket',
        workId: null,
        complete: false,
    })),
    choice: null,
};
const item = {
    ...sample.items[0]!,
    status: 'Ready to merge' as const,
    state: 'open' as const,
    parentId: null,
    flow: 'single' as const,
    threads: [],
    linkedPrs: [],
    needsYou: undefined,
    retro,
    revision: 7,
};
const board = fresh({ ...sample, items: [item] });
const card = () => $('.desk-row')!;
const details = () => $('[data-item-dialog]')!;
const button = (label: string) => [...details().querySelectorAll('button')].find((node) => text(node) === label)!;
const openChoice = () =>
    settle(() => [...card().querySelectorAll('button')].find((node) => text(node) === 'Choose follow-ups')!.click());

test('a compact card before merge opens the full choice in details and creates only checked follow-ups', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: null })));
    await mountPage(board);
    expect(document.querySelectorAll('.desk-row')).toHaveLength(1);
    expect(text(card())).toContain('Choose follow-ups · 6');
    expect(text(card())).toContain(item.title);
    expect(card().querySelector('input[type=checkbox]')).toBeNull();
    expect(text(card())).not.toContain('Full description');
    expect(card().querySelectorAll('[data-col="side"] button')).toHaveLength(2);
    await openChoice();
    expect(text(details())).toContain('Optional. Choose after merge if you like, or dismiss these follow-ups.');
    expect(text(details())).not.toContain('Choose follow-ups before the pull request can merge.');
    expect(details().querySelectorAll('input[type=checkbox]')).toHaveLength(6);
    for (let i = 1; i <= 6; i++) expect(text(details())).toContain(`Full description ${i}.`);
    expect(button('Create chosen follow-ups').disabled).toBe(true);
    await settle(() => details().querySelectorAll<HTMLInputElement>('input[type=checkbox]')[4]!.click());
    await settle(() => button('Create chosen follow-ups').click());
    expect(posted()).toContainEqual(['/api/choose-retro', { itemId: item.id, revision: 7, selected: [4] }]);
});

test('a pick whose follow-up creation failed stops waiting and shows a toast naming the follow-up', async () => {
    holdPosts(board);
    await mountPage(board);
    await openChoice();
    await settle(() => details().querySelectorAll<HTMLInputElement>('input[type=checkbox]')[4]!.click());
    await settle(() => button('Create chosen follow-ups').click());
    expect(
        [button('Create chosen follow-ups'), button('No follow-ups')].map((node) => node.getAttribute('aria-busy')),
        'the pressed button spins while the pick saves',
    ).toEqual(['true', null]);

    const chosen = { ...retro, choice: { selected: [4], by: 'User', at: 'today' } };

    await answer(
        {
            error: 'Could not create follow-up "Follow-up 5": Provider unavailable',
            board: fresh({ ...sample, items: [{ ...item, retro: chosen }] }),
        },
        409,
    );
    expect(text(toast())).toContain('Could not create follow-up "Follow-up 5"');
    expect(text(details())).not.toContain('Choose follow-ups');
    expect([...document.querySelectorAll('.desk-row')].some((row) => text(row).includes('Choose follow-ups'))).toBe(
        false,
    );
});

test('a Done pick survives on the desk, opens in details, and dismisses in one click', async () => {
    const done = { ...item, status: 'Done' as const };
    const board = fresh({ ...sample, items: [done] });

    holdPosts(board);
    await mountPage(board);
    expect(text(card())).toContain('Choose follow-ups · 6');
    expect(text(card())).toContain('Optional · Build done');
    await openChoice();
    expect(details().querySelectorAll('input[type=checkbox]')).toHaveLength(6);
    await settle(() =>
        [...details().querySelectorAll<HTMLButtonElement>('button')]
            .find((node) => node.getAttribute('aria-label') === 'Close')!
            .click(),
    );
    await settle(() => [...card().querySelectorAll('button')].find((node) => text(node) === 'Dismiss')!.click());
    expect(posted()).toContainEqual(['/api/choose-retro', { itemId: item.id, revision: 7, selected: [] }]);
    expect($('[data-item-dialog]')).toBeNull();
    expect(
        [...card().querySelectorAll('button')].find((node) => text(node) === 'Dismiss')?.getAttribute('aria-busy'),
    ).toBe('true');
    await answer({
        error: null,
        board: fresh({
            ...sample,
            items: [{ ...done, retro: { ...retro, choice: { selected: [], by: 'User', at: 'today' } } }],
        }),
    });
    expect($('.desk-row')).toBeNull();
});
