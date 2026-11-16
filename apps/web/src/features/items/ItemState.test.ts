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
