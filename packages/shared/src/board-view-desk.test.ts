import { describe, expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { deskItems, deskParentName, placementOf } from './board-view.ts';
import { nextAction } from './item-next-action.ts';
import type { Item, ItemThread } from './model.ts';

const work = (change: Partial<Item> = {}): Item => ({
    ...(sample.items[0] as Item),
    id: 'work',
    kind: 'issue',
    status: 'In progress',
    parentId: null,
    parent: null,
    threads: [],
    linkedPrs: [],
    ...change,
});
const question = { id: 'question', state: 'needs you' } as ItemThread;
const notice = { reason: 'Approve the brief', offers: [], causes: [], ticketOpen: true };
const kinds: [string, Partial<Item>, Item[]][] = [
    ['single issue', {}, []],
    ['bug', { kind: 'bug' }, []],
    ['feature', { kind: 'feature' }, []],
    ['improvement', { kind: 'improvement' }, []],
    ['build', { kind: 'build' }, []],
    ['concept', { kind: 'concept' }, []],
    ['decision', { kind: 'decision' }, []],
    ['linked parent', {}, [work({ id: 'child', parentId: 'work' })]],
    ['concept part', { parentId: 'parent' }, [work({ id: 'parent', kind: 'concept' })]],
    ['linked part', { parentId: 'parent' }, [work({ id: 'parent' })]],
    ['decision part', { kind: 'decision', parentId: 'parent' }, [work({ id: 'parent', kind: 'concept' })]],
];
const waits: [string, Partial<Item>, boolean][] = [
    ['question during a build', { threads: [question] }, true],
    ['tool approval', { threads: [question], status: 'Review' }, true],
    ['brief gate approval', { needsYou: notice, status: 'Shaping' }, true],
    ['saved question', { status: 'Needs you' }, true],
    ['Verify', { status: 'Verify' }, true],
    ['PR to merge', { status: 'Ready to merge' }, true],
    ['slice question owned by its build', { threads: [{ id: 'build', childNeedsYou: true } as ItemThread] }, true],
    ['agent running', { threads: [{ id: 'build', state: 'running', currentRunning: true } as ItemThread] }, false],
    ['Ready', { status: 'Ready' }, false],
    ['ordinary blocker', { blockers: [{ state: 'open' }] as Item['blockers'] }, false],
    ['unmet prerequisite', { slices: [{ progress: 'blocked' }] as Item['slices'] }, false],
    ['unknown activity', { threads: 'unavailable' }, false],
    ['old question', { threads: [{ ...question, observedAt: '2026-11-01' }] }, false],
    [
        'old slice question',
        { threads: [{ ...question, state: 'done', childNeedsYou: true, observedAt: '2026-11-01' }] },
        false,
    ],
    ['answered question', { threads: [{ ...question, state: 'done' }] }, false],
    [
        'CI running',
        {
            status: 'Ready to merge',
            linkedPrs: [{ state: 'open', checks: { running: 1, failed: 0 } }] as Item['linkedPrs'],
        },
        false,
    ],
];

for (const [kind, identity, relatives] of kinds) {
    describe(`${kind} desk placement`, () => {
        test.each(waits)('%s', (_name, wait, expected) => {
            const item = work({ ...identity, ...wait });
            const all = [item, ...relatives];
            const sections = placementOf(item, { all, unavailable: false }).sections;
            const grouped = kind === 'concept' || relatives.length > 0;

            expect(sections.includes('desk')).toBe(expected);
            expect(deskItems({ items: all }, false).some((entry) => entry.id === item.id)).toBe(expected);

            if (grouped) expect(sections.filter((section) => section !== 'desk')).toEqual(['dock']);
        });
    });
}

test('a grouped question targets its exact owning thread and does not put quiet relatives on the desk', () => {
    const parent = work({ id: 'parent', kind: 'concept', number: 200, title: 'Cloud sign-in' });
    const child = work({ parentId: parent.id, threads: [{ id: 'newer', state: 'done' } as ItemThread, question] });
    const all = [parent, child, work({ id: 'quiet', parentId: parent.id })];

    expect(deskItems({ items: all }, false)).toEqual([child]);
    expect(nextAction(child)).toEqual({ kind: 'thread', label: 'Answer in T3', threadId: 'question' });
    expect(deskParentName(child, all)).toBe('#200 Cloud sign-in');
});

test('parent identity uses current board data, falls back to the ticket, and names local unticketed work', () => {
    const parent = work({ id: 'parent', number: 0, title: 'Local parent' });
    const child = work({
        parentId: parent.id,
        parent: {
            number: 9,
            title: 'Ticket parent',
            repo: 'elsewhere/project',
            url: 'https://example.com/9',
            state: 'open',
        },
    });

    expect(deskParentName(child, [parent, child])).toBe('Local parent');
    expect(deskParentName(child, [child])).toBe('#9 Ticket parent');
    expect(deskParentName(work(), [])).toBeUndefined();
});
