import type { Retro } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, fetchMock, fresh, mountPage, posted, sample, settle, text } from '@/test/PageTest';

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
        error: null,
        complete: false,
    })),
    choice: null,
    delivery: { threadId: 'build', commandId: 'command', messageId: 'message', sent: true, error: null },
};
const item = {
    ...sample.items[0]!,
    status: 'Done' as const,
    state: 'closed' as const,
    parentId: null,
    flow: 'single' as const,
    threads: [],
    linkedPrs: [],
    needsYou: undefined,
    retro,
    revision: 7,
};
const board = fresh({ ...sample, items: [item] });
const card = () => $('.desk-card')!;
const details = () => $('[data-item-dialog]')!;
const button = (label: string) => [...details().querySelectorAll('button')].find((node) => text(node) === label)!;
const openChoice = () =>
    settle(() => [...card().querySelectorAll('button')].find((node) => text(node) === 'Choose follow-ups')!.click());

test('a compact Done card opens the full choice in details and creates only checked follow-ups', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: null })));
    await mountPage(board);
    expect(document.querySelectorAll('.desk-card')).toHaveLength(1);
    expect(text(card())).toContain('Choose follow-ups · 6');
    expect(text(card())).toContain(item.title);
    expect(card().querySelector('input[type=checkbox]')).toBeNull();
    expect(text(card())).not.toContain('Full description');
    expect(card().querySelectorAll('.desk-actions button')).toHaveLength(1);
    await openChoice();
    expect(details().querySelectorAll('input[type=checkbox]')).toHaveLength(6);
    for (let i = 1; i <= 6; i++) expect(text(details())).toContain(`Full description ${i}.`);
    expect(button('Create chosen follow-ups').disabled).toBe(true);
    await settle(() => details().querySelectorAll<HTMLInputElement>('input[type=checkbox]')[4]!.click());
    await settle(() => button('Create chosen follow-ups').click());
    expect(posted()).toContainEqual(['/api/choose-retro', { itemId: item.id, revision: 7, selected: [4] }]);
});

test('No follow-ups submits an explicit empty choice, while an empty retro has no card', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: null })));
    await mountPage(board);
    await openChoice();
    await settle(() => button('No follow-ups').click());
    expect(posted()).toContainEqual(['/api/choose-retro', { itemId: item.id, revision: 7, selected: [] }]);
});

test('no suggestions means no desk wait', async () => {
    await mountPage(fresh({ ...sample, items: [{ ...item, retro: { ...retro, suggestions: [], captures: [] } }] }));
    expect(card()).toBeNull();
});

test('a saved capture failure keeps the desk action and retries from details without another selection', async () => {
    const failure: Retro = {
        ...retro,
        choice: { selected: [0], by: 'Pedro', at: '2026-11-13' },
        captures: retro.captures.map((capture, index) => ({
            ...capture,
            error: index === 0 ? 'Provider refused access.' : null,
        })),
    };

    await mountPage(fresh({ ...sample, items: [{ ...item, retro: failure }] }));
    expect(text(card())).not.toContain('Provider refused access.');
    await openChoice();
    expect(text(details())).toContain('Provider refused access.');
    expect(details().querySelector('input[type=checkbox]')).toBeNull();
    await settle(() => button('Retry retro').click());
    expect(posted()).toContainEqual(['/api/retry-retro', { itemId: item.id, revision: 7 }]);
});

test('a grouped build keeps its parent context on the retro card', async () => {
    const parent = { ...item, id: 'parent', title: 'Media library', kind: 'concept' as const, retro: null };

    await mountPage(fresh({ ...sample, items: [parent, { ...item, parentId: parent.id, flow: 'linked' }] }));
    expect(text(card())).toContain(`Part of #${parent.number} Media library`);
});
