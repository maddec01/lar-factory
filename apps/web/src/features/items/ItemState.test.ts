import { itemActivityLine } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import sampleJson from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { expect, test } from 'vite-plus/test';

import { itemState } from './ItemState';

const sample = sampleJson as unknown as BoardData;

const item = (id: string, change: Partial<Item> = {}): Item => ({
    ...sample.items.find((candidate) => candidate.id === id)!,
    ...change,
});

/** The presenter as a page reads it at the sample's own time, with a trusted board and no start in flight. */
const stateOf = (subject: Item, inputs: { unavailable?: boolean; starting?: boolean } = {}) =>
    itemState(subject, {
        unavailable: inputs.unavailable ?? false,
        line: itemActivityLine(subject, Date.parse('2026-10-21T10:00:00Z'))?.state,
        lost: false,
        starting: inputs.starting ?? false,
    });

test('a stopped Review build says Stopped everywhere, keeps Review as its recorded stage and is resumed in T3', () => {
    const state = stateOf(item('I_sample15'));

    expect([state.word, state.stage, state.execution, state.state, state.resume, state.recorded]).toEqual([
        'Run stopped',
        'Review',
        'stopped',
        'off',
        true,
        'Recorded stage: Review',
    ]);
    expect(state.running).toBe(false);
});

test('a thread with a fresh working line is Working and animates, the same word and motion on every surface', () => {
    const state = stateOf(item('I_sample14'));

    expect([state.word, state.execution, state.running]).toEqual(['Working', 'working', true]);
    expect(stateOf(item('I_sample14'), { unavailable: true }).running, 'a stale board stills the motion').toBe(false);
});

test('a merged pull request at an earlier stage says so instead of the stage it hasn’t left yet', () => {
    const state = stateOf(item('I_sample23'));

    expect([state.word, state.state, state.light, state.recorded]).toEqual([
        'PR merged',
        'ready',
        true,
        'Recorded stage: In progress',
    ]);
});

test('a blocked Ready item says what it starts after, and a start in flight leaves the word to its own message', () => {
    expect(stateOf(item('I_sample13')).word).toBe('Blocked · starts after #202');
    expect(stateOf(item('I_sample13', { blockers: [] }), { starting: true })).toMatchObject({
        word: 'Ready',
        execution: 'starting',
        running: false,
    });
});

test('work the board holds for you never reads as running', () => {
    expect(
        stateOf(
            item('I_sample14', { needsYou: { reason: 'Its PR closed.', offers: [], causes: [], ticketOpen: true } }),
        ).running,
    ).toBe(false);
});

for (const id of ['I_sample13', 'I_sample05'])
    test(`Ready ${id} keeps shaping activity separate from build execution`, () => {
        expect(stateOf(item(id, { status: 'Ready', blockers: [] })).execution).toBeUndefined();
    });
test('failed PR checks share Verify while a merged PR advances to Merge', () => {
    for (const status of ['Verify', 'Ready to merge'] as const) {
        const subject = item('I_sample23', { status });

        subject.linkedPrs = [
            {
                ...subject.linkedPrs[0]!,
                state: 'open',
                checks: { failed: 1, running: 0, passed: 0, total: 1, since: null },
            },
        ];
        expect(stateOf(subject)).toMatchObject({ progressStage: 'Verify', word: 'Checks failed', state: 'failed' });
    }
    expect(stateOf(item('I_sample23')).progressStage).toBe('Merge');
});

test.each([
    ['question', 'Question'],
    ['tool-approval', 'Tool approval'],
    ['brief-approval', 'Approve brief'],
] as const)('rows name the same %s wait as the desk', (kind, label) => {
    const subject = item('I_sample14', {
        status: 'Needs you',
        threads: [
            {
                id: 'wait',
                title: 'Wait',
                state: 'needs you',
                updated: '2026-10-21T10:00:00Z',
                pendingRequest: { id: 'request', threadId: 'wait', kind },
            },
        ],
    });

    expect(stateOf(subject).word).toBe(label);
});

test('re-gating an active build keeps Build progress while its human wait says Approve brief', () => {
    const subject = item('I_sample14', {
        status: 'Needs you',
        buildPhase: 'implement',
        briefApproval: { reason: 'The brief changed during Build.' },
        threads: [],
    });

    expect(stateOf(subject)).toMatchObject({ progressStage: 'Build', word: 'Approve brief' });
});
