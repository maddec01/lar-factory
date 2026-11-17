import type { Retro } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, $$, answer, holdPosts, mountPage, posted, push, sample, settle, text } from '@/test/PageTest';

const comments = [
    {
        id: 'comment:1',
        author: 'Teammate',
        body: 'Please remember the language.',
        url: 'https://github.com/o/r/pull/8#issuecomment-1',
    },
];
const data = () => ({
    ...sample,
    items: sample.items
        .filter((i) => i.id === 'I_sample16')
        .map((i) => ({
            ...i,
            status: 'Ready to merge' as const,
            parentId: null,
            retro: undefined,
            verification: {
                required: false,
                head: null,
                latest: null,
                resume: null,
                prReview: true,
                prReviewHandedBack: true,
            },
            threads: [
                { id: 'owner', purpose: 'build', title: 'Build', state: 'done' as const, updated: sample.fetchedAt! },
            ],
            linkedPrs: [
                {
                    ...i.linkedPrs[0]!,
                    number: 8,
                    state: 'open' as const,
                    isDraft: false,
                    review: { required: 'green' as const, comments },
                },
            ],
        })),
});

test.each(['Address it'])(
    'feedback card shows a gist and all three choices; %s sends only the shown IDs',
    async (choice) => {
        const board = data();

        holdPosts(board);
        await mountPage(board);
        expect(text($('.desk-row'))).toContain('New comment on PR #8');
        expect(text($('.desk-row'))).toContain('Please remember the language.');
        expect($$('.desk-row button').some((button) => text(button) === 'Address it')).toBe(true);
        expect($$('.desk-row button').some((button) => text(button) === 'Dismiss')).toBe(true);
        expect($$('.desk-row a').some((link) => link.getAttribute('aria-label') === 'Open thread')).toBe(true);
        await settle(() =>
            $$<HTMLButtonElement>('.desk-row button')
                .find((button) => text(button) === choice)!
                .click(),
        );

        const sending = $('.desk-row button[aria-busy="true"]')!;

        expect(text(sending)).toBe(choice === 'Address it' ? 'Sending…' : 'Dismissing…');
        expect(sending.getAttribute('aria-disabled')).toBe('true');
        await settle(() => (sending as HTMLButtonElement).click());
        expect(posted()).toEqual([
            [
                '/api/pr-feedback',
                { itemId: 'I_sample16', action: choice === 'Dismiss' ? 'dismiss' : 'address', events: ['comment:1'] },
            ],
        ]);

        const working = {
            ...board,
            items: board.items.map((i) => ({
                ...i,
                linkedPrs: i.linkedPrs.map((pr) => ({
                    ...pr,
                    review: { required: 'green' as const, handlingFeedback: true },
                })),
            })),
        };

        await answer({ error: null, board: working });
        expect($('.desk-row')).toBeNull();
        expect(text(document.body)).toContain('Fixing review feedback');
        await push({
            ...board,
            items: board.items.map((i) => ({
                ...i,
                linkedPrs: i.linkedPrs.map((pr) => ({ ...pr, review: { required: 'green' as const } })),
            })),
        });
        expect(text($('.desk-row'))).toContain('Review PR #8');
        expect(text($('.desk-row'))).toContain('The factory’s part is done');
    },
);

const retro: Retro = {
    pr: 'o/r#8',
    suggestions: [
        { title: 'More languages', description: 'Add another language.', repository: 'o/r', kind: 'feature' },
    ],
    choice: null,
    captures: [],
};

test.each(['address', 'thread', 'reviewer', 'checks', 'conflict'] as const)(
    'optional Retro cannot resurrect merge handback during %s work or before green checks',
    async (cause) => {
        const board = data();
        const ready = {
            ...board,
            items: board.items.map((item) => ({
                ...item,
                retro,
                linkedPrs: item.linkedPrs.map((pr) => ({
                    ...pr,
                    mergeState: 'can merge' as const,
                    review: { required: 'green' as const },
                })),
            })),
        };
        const working = {
            ...ready,
            items: ready.items.map((item) => ({
                ...item,
                threads: item.threads.map((t) => ({
                    ...t,
                    currentRunning: cause === 'thread' ? (true as const) : undefined,
                    hasLiveChildren: cause === 'reviewer' ? (true as const) : undefined,
                })),
                linkedPrs: item.linkedPrs.map((pr) => ({
                    ...pr,
                    mergeState: cause === 'conflict' ? ('conflicts' as const) : pr.mergeState,
                    review: {
                        ...pr.review,
                        required: cause === 'checks' ? ('failed' as const) : pr.review.required,
                        comments: cause === 'checks' || cause === 'conflict' ? [] : comments,
                        handlingFeedback: cause !== 'thread' && cause !== 'reviewer',
                    },
                })),
            })),
        };

        await mountPage(working);
        expect(text(document.body)).toContain('Fixing review feedback');
        expect(text($('.desk-row [data-state]'))).toBe('Fixing review feedback');
        expect(text($('[data-stage="build"] [data-row-meta] [data-state]'))).toBe('Fixing review feedback');
        expect(text($('.desk-row'))).toContain('Choose follow-ups (optional) · 1');
        expect(text(document.body)).not.toContain('New comment on PR');
        expect(text($('.desk-row'))).not.toContain('Address it');
        expect(text($('.desk-row'))).not.toContain('The factory’s part is done');
        expect($$('.desk-row a').some((a) => text(a) === 'Review PR')).toBe(false);
        await push({
            ...ready,
            items: ready.items.map((item) => ({
                ...item,
                linkedPrs: item.linkedPrs.map((pr) => ({
                    ...pr,
                    review: { required: 'pending' as const },
                })),
            })),
        });
        expect(text(document.body)).toContain('Waiting for required checks');
        expect(text($('.desk-row'))).not.toContain('The factory’s part is done');
        await push(ready);
        expect(text($('.desk-row'))).toContain('Review PR #8');
        expect(text($('.desk-row'))).toContain('The factory’s part is done');
    },
);

test('failed Address it restores the choice and explains the failure', async () => {
    const board = data();

    holdPosts(board);
    await mountPage(board);
    await settle(() =>
        $$<HTMLButtonElement>('.desk-row button')
            .find((button) => text(button) === 'Address it')!
            .click(),
    );
    await answer({ error: 'Current PR feedback could not be read. Refresh and try again.' }, 409);
    expect(text($('.desk-row'))).toContain('Current PR feedback could not be read.');
    expect($('.desk-row button[aria-busy="true"]')).toBeNull();
    expect($$('.desk-row button').some((button) => text(button) === 'Address it')).toBe(true);
});

test.each([
    ['blocked', { unresolvedThreads: 1 }, '1 review thread unresolved'],
    ['conflicts', {}, 'Resolve conflicts'],
] as const)('merge blocker %s agrees across row and optional Retro card', async (mergeState, evidence, reason) => {
    const board = data();

    await mountPage({
        ...board,
        items: board.items.map((item) => ({
            ...item,
            retro,
            linkedPrs: item.linkedPrs.map((pr) => ({
                ...pr,
                mergeState,
                review: { required: 'green' as const, ...evidence },
            })),
        })),
    });
    expect(text(document.body)).toContain(reason);
    expect(text($('[data-stage="build"]'))).toContain(reason);
    expect(text($('.desk-row'))).toContain(reason);
    expect(text($('[data-stage="build"]'))).not.toContain('Ready to merge');
    expect(text($('.desk-row'))).not.toContain('The factory’s part is done');
});
