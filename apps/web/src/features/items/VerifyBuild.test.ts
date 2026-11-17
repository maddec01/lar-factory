import type { BoardData } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import {
    $,
    fetchMock,
    fresh,
    mountPage,
    posted,
    sample,
    settle,
    text,
    detailsRead,
    detailsReply,
} from '@/test/PageTest';

const head = 'a'.repeat(40);
const item = {
    ...sample.items.find((work) => work.id === 'I_sample16')!,
    threads: [],
    recorded: true,
    stats: undefined,
    usageState: undefined,
    verification: { required: true, head, latest: null, resume: null },
};
const board = fresh({ ...sample, items: [item] });
const context = {
    pr: `${item.repo}#8`,
    head,
    testSteps: '1. Press Say hello.\n2. Check the greeting.',
    revision: 5,
    by: 'Pedro',
};
const card = () => $('.desk-row')!;
const dialog = () => $('[data-item-dialog]')!;
const button = (label: string) => [...dialog().querySelectorAll('button')].find((node) => text(node) === label)!;

function api(after?: BoardData, error?: string) {
    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/inspect-verification')
            return new Response(JSON.stringify({ verification: context, error: null }));

        if (url === '/api/record-verification')
            return new Response(JSON.stringify({ board: after, error: error ?? null }));

        const id = detailsRead(url);

        return id ? detailsReply(id) : new Response(JSON.stringify(board));
    });
}

async function openVerify() {
    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));
    await settle();
}

test('legacy Verify remains available in the item dialog; only Fail asks for a note and submits the inspected revision', async () => {
    api();
    await mountPage(board);
    await settle();
    expect(card().querySelector('[data-verification]')).toBeNull();
    expect(text(card())).not.toContain('Press Say hello.');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/inspect-verification')).toBe(false);
    await openVerify();
    expect(text(dialog())).toContain('Press Say hello.');
    expect(text(dialog())).toContain('Testing head aaaaaaa');
    expect(text(dialog())).not.toContain(head);
    expect(text(dialog())).not.toContain('Recorded as');
    expect(text(dialog())).not.toContain('No agent work yet');
    expect(dialog().querySelector('[data-agent-work-note]')?.textContent).toBe('Build ready for verification');
    expect(dialog().querySelector('[data-verification] input')).toBeNull();
    expect(dialog().querySelector('[data-pr-link]')?.textContent).toBe('Open PR to test');
    await settle(() => button('Fail').click());
    expect((button('Submit failure') as HTMLButtonElement).disabled).toBe(true);

    const note = dialog().querySelector<HTMLInputElement>('[data-verification] input')!;

    expect(document.activeElement).toBe(note);
    await settle(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(note, 'Clipped greeting.');
        note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((button('Submit failure') as HTMLButtonElement).disabled).toBe(false);
    await settle(() => button('Cancel').click());
    expect(dialog().querySelector('[data-verification] input')).toBeNull();
    await settle(() => button('Fail').click());
    expect(dialog().querySelector<HTMLInputElement>('[data-verification] input')!.value).toBe('Clipped greeting.');
    await settle(() => button('Submit failure').click());
    expect(posted()).toContainEqual([
        '/api/record-verification',
        { itemId: item.id, ...context, result: 'fail', note: 'Clipped greeting.' },
    ]);
});
