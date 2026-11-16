import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { kindDisagreement, kindSwapAccessProblem, kindTicketSwap } from './kind-disagreement.ts';
import { effectiveVocabulary } from './vocabulary.ts';

const MAPPED = effectiveVocabulary({
    bug: { type: 'Bug', labels: ['type: bug'] },
    feature: { type: 'Feature', labels: ['type: feature', 'product'] },
}).vocabulary;
const NONE = effectiveVocabulary({}).vocabulary;
const record = (kind: string, more: Partial<Parameters<typeof kindDisagreement>[0]> = {}) => ({
    kind,
    agreedTicketKind: null,
    kindAnswer: null,
    ...more,
});
const ticket = (labels: string[], type: string | null = null) => ({ labels, type });

test('a difference with no agreed kind counts as the item having changed', () => {
    assert.deepEqual(kindDisagreement(record('bug'), ticket(['feature']), NONE), {
        ticketKind: 'feature',
        changed: 'item',
        kept: false,
        swap: { add: [], remove: ['feature'], type: null },
    });
});

test('the agreed kind tells which side changed', () => {
    assert.equal(
        kindDisagreement(record('feature', { agreedTicketKind: 'bug' }), ticket(['bug']), NONE)?.changed,
        'item',
    );
    assert.equal(
        kindDisagreement(record('bug', { agreedTicketKind: 'bug' }), ticket(['feature']), NONE)?.changed,
        'ticket',
    );
});

test('the swap names the labels and type an update changes', () => {
    assert.deepEqual(kindDisagreement(record('feature'), ticket(['type: bug', 'bug', 'docs'], 'Bug'), MAPPED)?.swap, {
        add: ['type: feature', 'product'],
        remove: ['type: bug', 'bug'],
        type: { from: 'Bug', to: 'Feature' },
    });
    assert.deepEqual(kindTicketSwap(ticket(['product'], 'feature'), 'feature', MAPPED), {
        add: ['type: feature'],
        remove: [],
        type: null,
    });
});

test('a kept answer holds until either kind changes, then the question returns', () => {
    const kept = { answer: 'keep', itemKind: 'bug', ticketKind: 'feature' };

    assert.equal(kindDisagreement(record('bug', { kindAnswer: kept }), ticket(['feature']), NONE)?.kept, true);
    assert.equal(kindDisagreement(record('bug', { kindAnswer: kept }), ticket(['improvement']), NONE)?.kept, false);
    assert.equal(kindDisagreement(record('improvement', { kindAnswer: kept }), ticket(['feature']), NONE)?.kept, false);
});

test('a swap needs access only for what it writes', () => {
    const swap = { add: ['bug'], remove: [], type: null };

    assert.match(kindSwapAccessProblem('team/app', swap, { 'tag-ticket': 'refused' })!, /tag-ticket was refused/);
    assert.equal(kindSwapAccessProblem('team/app', swap, { 'tag-ticket': 'allowed' }), null);
    assert.equal(kindSwapAccessProblem('team/app', { add: [], remove: [], type: null }, {}), null);
    assert.match(
        kindSwapAccessProblem(
            'team/app',
            { add: [], remove: [], type: { from: null, to: 'Bug' } },
            { 'type-ticket': 'refused' },
        )!,
        /type-ticket was refused/,
    );
    assert.match(
        kindSwapAccessProblem('org/project/repo', swap, { 'tag-ticket': 'allowed' }, { azureReadOnly: true })!,
        /read-only/,
    );
});
