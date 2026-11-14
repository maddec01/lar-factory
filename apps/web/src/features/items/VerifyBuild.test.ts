import type { BoardData } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import {
    $,
    fetchMock,
    fresh,
    mountPage,
    posted,
    sample,
    settle,
    text,
    stream,
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
    await settle(() => [...card().querySelectorAll('button')].find((node) => text(node) === 'Verify build')!.click());
    await settle();
}

test('the compact desk action opens Verify details; only Fail asks for a note and submits the inspected revision', async () => {
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
test('passing needs no note and shows recorded evidence only in details', async () => {
    const after = fresh({
        ...board,
        items: [
            {
                ...item,
                status: 'Ready to merge',
                verification: {
                    ...item.verification,
                    latest: { ...context, id: 'result', result: 'pass', at: '2026-11-13T12:00:00Z', note: null },
                },
            },
        ],
    });

    api(after);
    await mountPage(board);
    await openVerify();
    await settle(() => button('Fail').click());

    const abandoned = dialog().querySelector<HTMLInputElement>('[data-verification] input')!;

    await settle(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(abandoned, 'Abandoned draft.');
        abandoned.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(() => button('Cancel').click());
    await settle(() => button('Pass').click());
    expect(posted()).toContainEqual([
        '/api/record-verification',
        { itemId: item.id, ...context, result: 'pass', note: '' },
    ]);
    expect(text(card())).not.toContain('Passed by');
    expect(dialog().querySelector('[data-verification]')).toBeNull();
    expect(text(dialog())).toContain('Passed by Pedro at');
    expect(text(dialog())).toContain('Tested head aaaaaaa');

    const advanced = fresh({
        ...after,
        items: after.items.map((work) => ({
            ...work,
            status: 'In progress' as const,
            linkedPrs: [{ ...work.linkedPrs[0]!, sourceRevision: 'b'.repeat(40) }],
        })),
    });

    await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(advanced) })));
    expect(text(dialog())).toContain('Tested head aaaaaaa · superseded by bbbbbbb');
});
test('stale-head refusal keeps the failure draft and offers an explicit PR head reread', async () => {
    api(undefined, 'The PR head changed. Re-read PR head.');
    await mountPage(board);
    await openVerify();
    await settle(() => button('Fail').click());

    const note = dialog().querySelector<HTMLInputElement>('[data-verification] input')!;

    await settle(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(note, 'Needs fixing.');
        note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(() => button('Submit failure').click());
    expect(note.value).toBe('Needs fixing.');
    expect(text(dialog())).toContain('The PR head changed.');

    const reads = fetchMock.mock.calls.filter(([url]) => url === '/api/inspect-verification').length;

    await settle(() => button('Re-read PR head').click());
    expect(vi.mocked(fetchMock).mock.calls.filter(([url]) => url === '/api/record-verification')).toHaveLength(1);
    expect(vi.mocked(fetchMock).mock.calls.filter(([url]) => url === '/api/inspect-verification')).toHaveLength(
        reads + 1,
    );
});

test('details keeps earlier exact-head results readable while the next head awaits Verify', async () => {
    const failed = {
        ...context,
        id: 'failed',
        result: 'fail' as const,
        at: '2026-11-13T11:00:00Z',
        note: 'Clipped greeting.',
    };
    const passed = {
        ...context,
        id: 'passed',
        head: 'b'.repeat(40),
        result: 'pass' as const,
        at: '2026-11-13T12:00:00Z',
        note: null,
    };
    const historyBoard = fresh({
        ...board,
        items: [
            {
                ...item,
                verification: { ...item.verification, latest: passed, history: [passed, failed], invalidated: true },
            },
        ],
    });

    api();
    await mountPage(historyBoard);
    await openVerify();
    expect(text(dialog())).toContain('Verify results');
    expect(text(dialog())).toContain('Failed by Pedro at');
    expect(text(dialog())).toContain('Passed by Pedro at');
    expect(text(dialog())).toContain('Tested head aaaaaaa');
    expect(text(dialog())).toContain('Tested head bbbbbbb · superseded by aaaaaaa');
    expect(text(dialog())).toContain('Clipped greeting.');
    expect(dialog().querySelector('[data-verification]')).not.toBeNull();
});
