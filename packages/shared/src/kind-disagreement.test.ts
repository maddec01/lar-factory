import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { kindDisagreement, kindSwapAccessProblem, kindTicketSwap, ticketKindOf } from './kind-disagreement.ts';
import { effectiveVocabulary } from './vocabulary.ts';

const MAPPED = effectiveVocabulary({
  bug: { type: 'Bug', labels: ['type: bug'] },
  feature: { type: 'Feature', labels: ['type: feature', 'product'] },
}).vocabulary;
const NONE = effectiveVocabulary({}).vocabulary;
const record = (kind: string, more: Partial<Parameters<typeof kindDisagreement>[0]> = {}) => ({ kind, agreedTicketKind: null, kindAnswer: null, ...more });
const ticket = (labels: string[], type: string | null = null) => ({ labels, type });

test('the ticket\'s kind comes from its mapped labels and type, then the kind names', () => {
  assert.equal(ticketKindOf('feature', ticket(['type: bug']), MAPPED), 'bug');
  assert.equal(ticketKindOf('feature', ticket([], 'Bug'), MAPPED), 'bug');
  assert.equal(ticketKindOf('bug', ticket(['Enhancement']), NONE), 'feature');
  assert.equal(ticketKindOf('bug', ticket([], 'User Story'), NONE), 'feature');
  assert.equal(ticketKindOf('bug', ticket(['docs'], 'Task'), NONE), null);
});

test('a ticket carrying the item\'s kind agrees, whichever other name trackerKind would read first', () => {
  assert.equal(ticketKindOf('feature', ticket(['bug', 'TYPE: FEATURE']), MAPPED), 'feature');
  assert.equal(ticketKindOf('feature', ticket(['bug'], 'feature'), MAPPED), 'feature');
  assert.equal(ticketKindOf('improvement', ticket(['bug', 'improvement']), NONE), 'improvement');
  assert.equal(kindDisagreement(record('feature'), ticket(['bug', 'type: feature']), MAPPED), null);
});

test('a label mapped to another kind beats a kind name, as the repository chose it', () => {
  const renamed = effectiveVocabulary({ improvement: { type: null, labels: ['bug'] } }).vocabulary;
  assert.equal(ticketKindOf('feature', ticket(['bug']), renamed), 'improvement');
});

test('build and concept labels say nothing about the ordinary kinds', () => {
  assert.equal(ticketKindOf('bug', ticket(['build', 'concept', 'decision-grill']), NONE), null);
  assert.equal(ticketKindOf('feature', ticket(['build', 'bug']), NONE), 'bug');
});

for (const kind of ['concept', 'decision', 'build', 'slice', 'issue']) {
  test(`a ${kind} never disagrees`, () => {
    assert.equal(kindDisagreement(record(kind), ticket(['bug']), MAPPED), null);
  });
}

test('a difference with no agreed kind counts as the item having changed', () => {
  assert.deepEqual(kindDisagreement(record('bug'), ticket(['feature']), NONE), {
    ticketKind: 'feature', changed: 'item', kept: false, swap: { add: [], remove: ['feature'], type: null },
  });
});

test('the agreed kind tells which side changed', () => {
  assert.equal(kindDisagreement(record('feature', { agreedTicketKind: 'bug' }), ticket(['bug']), NONE)?.changed, 'item');
  assert.equal(kindDisagreement(record('bug', { agreedTicketKind: 'bug' }), ticket(['feature']), NONE)?.changed, 'ticket');
});

test('a ticket with no kind disagrees only when the item\'s kind has a mapped label or type to add', () => {
  assert.equal(kindDisagreement(record('improvement'), ticket(['docs']), MAPPED), null);
  assert.equal(kindDisagreement(record('bug'), ticket(['docs']), NONE), null);
  assert.deepEqual(kindDisagreement(record('bug', { agreedTicketKind: 'bug' }), ticket(['docs'], 'Task'), MAPPED), {
    ticketKind: null, changed: 'item', kept: false, swap: { add: ['type: bug'], remove: [], type: { from: 'Task', to: 'Bug' } },
  });
  const typeOnly = effectiveVocabulary({ bug: { type: 'Bug', labels: [] } }).vocabulary;
  assert.equal(kindDisagreement(record('bug'), ticket([], null), typeOnly)?.ticketKind, null);
});

test('the swap names the labels and type an update changes', () => {
  assert.deepEqual(kindDisagreement(record('feature'), ticket(['type: bug', 'bug', 'docs'], 'Bug'), MAPPED)?.swap, {
    add: ['type: feature', 'product'], remove: ['type: bug', 'bug'], type: { from: 'Bug', to: 'Feature' },
  });
  assert.deepEqual(kindTicketSwap(ticket(['product'], 'feature'), 'feature', MAPPED), { add: ['type: feature'], remove: [], type: null });
});

test('a kept answer holds until either kind changes, then the question returns', () => {
  const kept = { answer: 'keep', itemKind: 'bug', ticketKind: 'feature' };
  assert.equal(kindDisagreement(record('bug', { kindAnswer: kept }), ticket(['feature']), NONE)?.kept, true);
  assert.equal(kindDisagreement(record('bug', { kindAnswer: kept }), ticket(['improvement']), NONE)?.kept, false);
  assert.equal(kindDisagreement(record('improvement', { kindAnswer: kept }), ticket(['feature']), NONE)?.kept, false);
});

test('a kept answer can cover a ticket with no kind', () => {
  const kept = { answer: 'keep', itemKind: 'bug', ticketKind: null };
  assert.equal(kindDisagreement(record('bug', { kindAnswer: kept }), ticket([]), MAPPED)?.kept, true);
  assert.equal(kindDisagreement(record('bug', { kindAnswer: kept }), ticket(['feature']), MAPPED)?.kept, false);
});

test('an update answer ends the question for the kinds it covers', () => {
  const updated = { answer: 'update', itemKind: 'improvement', ticketKind: 'bug' };
  assert.equal(kindDisagreement(record('improvement', { kindAnswer: updated }), ticket([], 'Bug'), NONE), null);
  assert.equal(kindDisagreement(record('improvement', { kindAnswer: updated }), ticket([], 'Feature'), NONE)?.kept, false);
});

test('a swap needs access only for what it writes', () => {
  const swap = { add: ['bug'], remove: [], type: null };
  assert.match(kindSwapAccessProblem('team/app', swap, { 'tag-ticket': 'refused' })!, /tag-ticket was refused/);
  assert.equal(kindSwapAccessProblem('team/app', swap, { 'tag-ticket': 'allowed' }), null);
  assert.equal(kindSwapAccessProblem('team/app', { add: [], remove: [], type: null }, {}), null);
  assert.match(kindSwapAccessProblem('team/app', { add: [], remove: [], type: { from: null, to: 'Bug' } }, { 'type-ticket': 'refused' })!, /type-ticket was refused/);
  assert.match(kindSwapAccessProblem('org/project/repo', swap, { 'tag-ticket': 'allowed' }, { azureReadOnly: true })!, /read-only/);
});
