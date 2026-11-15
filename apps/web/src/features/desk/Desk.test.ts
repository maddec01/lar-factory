// Your desk: Needs you, Verify and Ready to merge items and open questions as a grid of cards, each opening the item dialog
// and carrying the buttons for its next action, narrowed by the board's Scope, Kind and Labels; and the line's heading below it.

import type { BoardData, Item } from '@lar-factory/shared';
import { describe, expect, test } from 'vite-plus/test';

import { $, $$, mountPage, sample, settle, text } from '@/test/PageTest';

const cards = () => $$('.desk-row');
const card = (id: string) => $(`.desk-row[data-item="${id}"]`)!;
/** Opens a card as a click anywhere on it does: on its row's open button. */
const open = (id: string) => card(id).querySelector<HTMLButtonElement>('[data-row-open]')!.click();
/** The card's next-step line, under its title, past its question and what it belongs to. */
const nextLine = (id: string) =>
    text(card(id).querySelector('[data-desk-more] > :not([data-question], [data-part-of])'));
/** The PR checks a card's head shows in place of its workflow track, in a word: "1 failed", "3/5" or "passed". */
const checksWord = (id: string) => text(card(id).querySelector('[data-card-head] [data-checks-word]'));
/** The head's checks track, as a screen reader names it. */
const checksTrack = (id: string) =>
    card(id).querySelector('[data-card-head] [data-checks-track]')?.getAttribute('aria-label');
const dialog = () => $('[data-item-dialog]');
const withItem = (id: string, change: Partial<Item>): BoardData => ({
    ...sample,
    items: sample.items.map((i) => (i.id === id ? { ...i, ...change } : i)),
});

test('a Verify card for an issue whose PR has no checks and conflicts says the conflict once, as its wait, and opens the PR', async () => {
    await mountPage();
    expect(text(card('I_sample28').querySelector('[data-state]'))).toMatch(/^Resolve conflicts · /);
    expect(nextLine('I_sample28'), 'the wait already says it').toBe('');
    expect(text(card('I_sample28').querySelector('[data-col="side"] a, [data-col="side"] button'))).toBe('Open PR');
    expect(text(card('I_sample28')), 'no checks yet, in words').toContain('No checks yet');
    expect(checksWord('I_sample28'), 'no checks to draw').toBe('');
});

test('a Verify card whose checks failed says so as its wait, its button reviewing them', async () => {
    await mountPage();
    expect(text(card('I_sample27').querySelector('[data-state]'))).toMatch(/^Checks failed · /);
    expect(text(card('I_sample27').querySelector('[data-col="side"] a, [data-col="side"] button'))).toBe(
        'Review failed checks',
    );
});

test('a Verify card whose PR checks were read shows them in its head in place of the next-step line', async () => {
    await mountPage();
    expect(checksWord('I_sample27')).toBe('1 failed');
    expect(checksTrack('I_sample27')).toMatch(/1 failed/);
    expect(text(card('I_sample27').querySelector('[data-card-head]'))).toContain('Verify');
    expect(nextLine('I_sample27')).toBe('');
});

test('a Verify card reads the PR Open PR opens, its first linked one', async () => {
    const linkedPrs = (id: string) => sample.items.find((i) => i.id === id)!.linkedPrs;

    await mountPage(
        withItem('I_sample16', {
            linkedPrs: [...linkedPrs('I_sample16'), { ...linkedPrs('I_sample27')[0]!, number: 99 }],
        }),
    );
    expect(checksWord('I_sample16')).toBe('passed');
    expect(text(card('I_sample16'))).toContain('Verify');
});

test('clicks on a card’s buttons open no item dialog', async () => {
    await mountPage(withItem('I_sample12', { parentId: null }));
    await settle(() => card('I_sample12').querySelector<HTMLElement>('[data-open-thread]')!.click());
    await settle(() => card('I_sample16').querySelector<HTMLElement>('[data-pr-link]')!.click());
    expect(dialog()).toBeNull();
});

const feature = (item: Item) => ({ ...item, kind: 'feature' as const });
const FILTERED = 'Your desk0Nothing on your desk matches the filters.';
const seedFilters = (kinds: string[], labels: string[] = []) =>
    localStorage.setItem('lar-board:filters:board', JSON.stringify({ kinds, labels }));

describe('narrowed by Scope, Kind and Labels', () => {
    test('Kind and Labels narrow the cards, and the heading counts what stays while the title bar counts the whole factory', async () => {
        const data: BoardData = {
            ...sample,
            items: sample.items.map((i) =>
                i.id === 'I_sample16'
                    ? { ...i, kind: 'bug' as const, labels: ['area: web'] }
                    : i.kind === 'bug'
                      ? feature(i)
                      : i,
            ),
        };

        seedFilters(['bug'], ['area: web']);
        await mountPage(data);
        expect(cards().map((c) => c.dataset.item)).toEqual(['I_sample16']);
        expect(text($('#desk-h')!.parentElement)).toBe('Your desk1');
        expect(text($('[data-slot=toolbar-counter]')), 'need you counts the whole factory').toBe('need you: 7need you');
    });

    test('a Scope with nothing on the desk says the filters hide it while another repository has cards', async () => {
        const data: BoardData = {
            ...sample,
            items: sample.items.filter(
                (i) => i.repo !== 'maddec01/lar-apple' || !['Needs you', 'Verify', 'Ready to merge'].includes(i.status),
            ),
        };

        localStorage.setItem('lar-board:scope', 'maddec01/lar-apple');
        await mountPage(data);
        expect(text($('.desk'))).toBe(FILTERED);
    });

    test('the disconnected message comes before the filtered one', async () => {
        seedFilters([], ['no such label']);
        await mountPage();

        const { useBoardStore } = await import('@/services/board/board.hooks');

        await settle(() => useBoardStore.getState().fail('down'));
        expect(text($('.desk'))).toBe('Your desk0Nothing waited on you at the last read.');
    });
});

/** Opens a grouped part through the item dialog, where its answer action remains available. */
const openPart = async () =>
    settle(async () => (await import('@/features/item-dialog')).useItemDialogStore.getState().open('I_sample12'));
/** The dialog's last thread action, which answers a question: in the notice that says so, or else the footer's. */
const answerAction = () =>
    [...dialog()!.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>('[data-open-thread]')].at(-1)!;

const questionBoard = (child: Partial<Item> = {}, concept: Partial<Item> = {}): BoardData => ({
    ...sample,
    items: sample.items.map((item) =>
        item.id === 'I_sample09'
            ? {
                  ...item,
                  status: 'Needs you',
                  threads: [
                      {
                          id: 'concept-question',
                          title: 'Concept question',
                          state: 'needs you',
                          updated: '2026-10-21T09:00:00.000Z',
                      },
                  ],
                  ...concept,
              }
            : item.id === 'I_sample12'
              ? { ...item, status: 'Needs you', parentId: 'I_sample09', threads: [], ...child }
              : item,
    ),
});

test('a decision with no thread answers in its concept thread without inheriting its thread association or usage', async () => {
    const data = questionBoard({ stats: undefined });

    await mountPage(data);

    await openPart();

    const action = answerAction() as HTMLAnchorElement;

    expect([text(action), action.href]).toEqual([
        'Answer in concept thread',
        't3code://threads/sample-environment/concept-question',
    ]);

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const child = useBoardStore.getState().data.items.find((item) => item.id === 'I_sample12')!;

    expect(child.threads).toEqual([]);
    expect(child.stats).toBeUndefined();
    expect(card('I_sample09')).not.toBeNull();
    expect(card('I_sample12')).not.toBeNull();
    expect(card('I_sample12').querySelector('[data-open-thread]')?.getAttribute('href')).toBe(action.href);
    expect(text(card('I_sample12'))).toContain('in #200 lar cloud: sign-in and direct connections');
    expect(text(dialog()!.querySelector('[data-open-thread]'))).toBe('Answer in concept thread');
});

test('a decision keeps its own thread even when its concept has a waiting thread', async () => {
    await mountPage(
        questionBoard({
            threads: [{ id: 'own-decision', title: 'Decision', state: 'stopped', updated: '2026-10-21T09:00:00.000Z' }],
        }),
    );

    await openPart();

    const action = answerAction() as HTMLAnchorElement;

    expect(action.href).toBe('t3code://threads/sample-environment/own-decision');
    expect(text(action)).toBe('Open thread');
});

test.each([
    ['unavailable child observations', { threads: 'unavailable' }, {}],
    ['unavailable concept observations', {}, { threads: 'unavailable' }],
    [
        'retained concept observations',
        {},
        {
            threads: [
                {
                    id: 'stale-concept',
                    title: 'Old question',
                    state: 'needs you',
                    updated: '2026-10-21T09:00:00.000Z',
                    observedAt: '2026-10-21T09:01:00.000Z',
                },
            ],
        },
    ],
    [
        'a finished concept thread',
        {},
        { threads: [{ id: 'done-concept', title: 'Finished', state: 'done', updated: '2026-10-21T09:00:00.000Z' }] },
    ],
    ['a missing parent', { parentId: 'missing' }, {}],
    ['a parent cycle', { parentId: 'I_sample12' }, {}],
    ['an unrelated repository thread', { parentId: null }, {}],
] satisfies [string, Partial<Item>, Partial<Item>][])(
    'a decision keeps navigation without borrowing an unrelated question for %s',
    async (_name, child, concept) => {
        await mountPage(questionBoard(child, concept));

        await openPart();

        const action = answerAction() as HTMLButtonElement;

        expect(text(action)).toBe('Open thread');

        if (_name === 'retained concept observations' || _name === 'a finished concept thread') {
            expect(action.tagName).toBe('A');
            expect(action.getAttribute('href')).toContain(
                _name === 'retained concept observations' ? 'stale-concept' : 'done-concept',
            );
        } else {
            expect(action.tagName).toBe('BUTTON');
            expect(action.disabled).toBe(true);
            expect(action.getAttribute('href')).toBeNull();
        }
    },
);

test('a Ready part stays in its dossier without a desk card or Ready to build row', async () => {
    await mountPage();
    expect($('.desk-row[data-item="I_sample13"]')).toBeNull();
    expect($('[data-stage="ready"] [data-item="I_sample13"]')).toBeNull();
    await settle(() => $<HTMLButtonElement>('[data-dossier="I_sample09"] [data-dossier-open]')!.click());
    expect(
        $(
            '[data-dossier="I_sample09"] [data-map-part="I_sample13"], [data-dossier="I_sample09"] [data-part="I_sample13"]',
        ),
    ).not.toBeNull();
});

test('shaping questions target the older question and leave the desk on a board update', async () => {
    const data = withItem('I_sample12', {
        parentId: null,
        status: 'Shaping',
        threads: [
            { id: 'newer', title: 'Newer', state: 'done', updated: '2026-11-02' },
            { id: 'question', title: 'Question', state: 'needs you', updated: '2026-11-01' },
        ],
    });

    await mountPage(data);
    expect(nextLine('I_sample12'), 'its action says it').toBe('');
    expect(card('I_sample12').querySelector('a')?.getAttribute('href')).toBe(
        't3code://threads/sample-environment/question',
    );
    await settle(() => open('I_sample12'));

    // The notice answers the question; the newer thread stays in reach elsewhere in the dialog.
    const links = [...dialog()!.querySelectorAll('a[href^="t3code:"]')].map((a) => [text(a), a.getAttribute('href')]);

    expect(text(dialog()!.querySelector('[data-open-thread]'))).toBe('Answer in T3');
    expect(links).toContainEqual(['Answer in T3', 't3code://threads/sample-environment/question']);
    expect(
        links.map(([, href]) => href),
        'the newer thread stays in reach',
    ).toContain('t3code://threads/sample-environment/newer');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive({
            ...data,
            items: data.items.map((item) => (item.id === 'I_sample12' ? { ...item, threads: [] } : item)),
        }),
    );
    expect(card('I_sample12')).toBeNull();
});

test('a child opens a running concept thread and answers only a later question in that concept', async () => {
    const running = { id: 'concept-running', title: 'Running', state: 'running' as const, updated: '2026-11-11' };
    const data = questionBoard({}, { threads: [running] });

    await mountPage(data);

    await openPart();

    const action = () => answerAction() as HTMLAnchorElement;

    expect([text(action()), action().href]).toEqual([
        'Open thread',
        't3code://threads/sample-environment/concept-running',
    ]);
    expect(card('I_sample12')).not.toBeNull();
    expect(card('I_sample12').querySelector('[data-open-thread]')?.getAttribute('href')).toBe(action().href);
    expect(text(card('I_sample12'))).toContain('in #200 lar cloud: sign-in and direct connections');
    expect(text(dialog()!.querySelector('[data-open-thread]'))).toBe('Open thread');

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const waiting = questionBoard({}, { threads: [running, { ...running, id: 'later-question', state: 'needs you' }] });

    await settle(() => useBoardStore.getState().receive(waiting));
    expect([text(action()), action().href]).toEqual([
        'Answer in concept thread',
        't3code://threads/sample-environment/later-question',
    ]);
    await settle(() => useBoardStore.getState().receive(data));
    expect(text(action())).toBe('Open thread');
    expect(text(dialog()!.querySelector('[data-open-thread]'))).toBe('Open thread');
});

test.each(['running', 'stopped', 'done', 'retained'] as const)(
    'Needs you cards and dialogs open their own %s thread without answer wording',
    async (state) => {
        const data = questionBoard({
            parentId: null,
            threads: [
                {
                    id: 'own-thread',
                    title: 'Own thread',
                    state: state === 'retained' ? 'needs you' : state,
                    updated: '2026-11-11',
                    observedAt: state === 'retained' ? '2026-11-11' : undefined,
                },
            ],
        });

        await mountPage(data);

        const action = card('I_sample12').querySelector<HTMLAnchorElement>('[data-open-thread]')!;

        expect([text(action), action.href]).toEqual(['Open thread', 't3code://threads/sample-environment/own-thread']);
        await settle(() => open('I_sample12'));
        expect(text(dialog()!.querySelector('[data-open-thread]'))).toBe('Open thread');
    },
);

test.each(['own', 'concept'] as const)(
    '%s answer wording clears while disconnected and returns only for a newly observed question',
    async (owner) => {
        const data =
            owner === 'concept'
                ? questionBoard()
                : questionBoard({
                      threads: [
                          {
                              id: 'own-question',
                              title: 'Question',
                              state: 'needs you',
                              updated: '2026-11-11',
                          },
                      ],
                  });

        await mountPage(data);
        await openPart();

        const action = () => dialog()!.querySelector('[data-open-thread]')!;
        const { useBoardStore } = await import('@/services/board/board.hooks');
        const answer = owner === 'concept' ? 'Answer in concept thread' : 'Answer in T3';

        expect(text(action())).toBe(answer);
        await settle(() => useBoardStore.getState().fail('Connection lost'));
        expect(text(action())).toBe('Open thread');
        expect(action().getAttribute('href')).toBe(
            owner === 'concept'
                ? 't3code://threads/sample-environment/concept-question'
                : 't3code://threads/sample-environment/own-question',
        );
        await settle(() =>
            useBoardStore.getState().receive({
                ...data,
                items: data.items.map((item) =>
                    item.id === (owner === 'concept' ? 'I_sample09' : 'I_sample12') && Array.isArray(item.threads)
                        ? { ...item, threads: item.threads.map((thread) => ({ ...thread, state: 'done' as const })) }
                        : item,
                ),
            }),
        );
        expect(text(action())).toBe('Open thread');
        await settle(() => useBoardStore.getState().receive(data));
        expect(text(action())).toBe(answer);
    },
);

test('review progress identifies the delivery PR, updates without a dialog and marks retained counts stale on disconnect', async () => {
    const original = sample.items.find((i) => i.id === 'I_sample27')!;
    const data = withItem(original.id, {
        linkedPrs: [
            {
                ...original.linkedPrs[0]!,
                number: 881,
                checks: { passed: 2, running: 1, failed: 1, total: 4, since: null },
                checkProgress: { state: 'current' },
            },
        ],
    });

    await mountPage(data);
    // The head's checks track takes the counts block's place.
    expect(checksWord(original.id)).toBe('1 failed');
    expect(checksTrack(original.id)).toBe('2 of 4 checks passed · 1 failed · 1 running');
    expect(text(card(original.id))).not.toContain('PR #881');
    expect(text(card(original.id))).toContain('Review failed checks');
    expect(dialog()).toBeNull();

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive(
            withItem(original.id, {
                linkedPrs: [
                    {
                        ...data.items.find((i) => i.id === original.id)!.linkedPrs[0]!,
                        checks: { passed: 4, running: 0, failed: 0, total: 4, since: null },
                    },
                ],
            }),
        ),
    );
    expect(checksWord(original.id)).toBe('passed');
    expect(checksTrack(original.id)).toBe('4 of 4 checks passed');
    await settle(() => useBoardStore.getState().fail('offline'));
    // Disconnected, the track that would look current gives way to the counts in words with their stale warning.
    expect(checksWord(original.id)).toBe('');
    expect(text(card(original.id))).toContain('4 passed');
    expect(dialog()).toBeNull();
    expect(text(card(original.id))).toContain('Stale check observation');
});

test.each([
    ['loading', { pipelineUnread: true, checks: null, checkProgress: undefined }, 'Loading checks…'],
    ['unread source checks', { checks: null, checkProgress: undefined }, 'Loading checks…'],
    ['zero checks', { checks: null, checkProgress: { state: 'current' } }, 'No checks yet'],
    ['unavailable', { checks: null, checkProgress: { state: 'unavailable' } }, 'Check evidence unavailable.'],
    ['retained counts', { checkProgress: { state: 'stale' } }, 'Stale check observation.'],
    [
        'limited Azure coverage',
        {
            checkProgress: {
                state: 'current',
                coverage: 'build-validation',
                prWideChecks: { passed: 0, running: 1, failed: 0, total: 1, since: null },
            },
        },
        'Limited coverage: build validation only.',
    ],
] satisfies [string, Partial<Item['linkedPrs'][number]>, string][])(
    'a desk card distinguishes %s beside its question',
    async (_name, patch, message) => {
        const original = sample.items.find((i) => i.id === 'I_sample27')!;

        await mountPage(
            withItem(original.id, {
                status: 'Needs you',
                threads: [{ id: 'question', title: 'Question', state: 'needs you', updated: '2026-11-01' }],
                linkedPrs: [{ ...original.linkedPrs[0]!, ...patch }],
            }),
        );
        expect(text(card(original.id))).toContain(message);
        expect(text(card(original.id))).toContain('Answer in T3');

        if (patch.checkProgress && 'prWideChecks' in patch.checkProgress)
            expect(text(card(original.id))).toContain('PR-wide statuses0 passed · 1 running · 0 failed · 1 total');

        expect(dialog()).toBeNull();
    },
);

test('a provider disconnect marks retained progress stale while its readiness blocker remains visible', async () => {
    const data = { ...sample, itemSourceProblems: [{ repo: 'maddec01/lar-apple', problem: 'Provider unavailable' }] };

    await mountPage(data);
    // A project the board can't read leaves its checks as last seen: counts in words with their warning, not a track.
    expect(checksWord('I_sample27')).toBe('');
    expect(text(card('I_sample27'))).toContain('Review failed checks');
    expect(text(card('I_sample27'))).toContain('Stale check observation.');
});
