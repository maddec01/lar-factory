import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { customLabelProblem, customTagProblem } from './custom-labels.ts';
import { isManagedLabel, shownLabels } from './managed-labels.ts';
import { trackerKind } from './tracker-structure.ts';
import { effectiveVocabulary } from './vocabulary.ts';

const KIND_NAMES = ['concept', 'decision', 'decision-grill', 'bug', 'defect', 'feature', 'enhancement', 'user story', 'product backlog item', 'improvement', 'build'];
const STATUS_NAMES = ['status-queued', 'status-needs-you'];
const mapped = (kind: 'bug' | 'feature', ...labels: string[]) => effectiveVocabulary({ [kind]: { type: null, labels } }).vocabulary;

test('every name trackerKind reads, linked-work and status-* are managed, in any case', () => {
  for (const name of [...KIND_NAMES, ...STATUS_NAMES, 'linked-work']) {
    assert.equal(isManagedLabel(name), true, name);
    assert.equal(isManagedLabel(name.toUpperCase()), true, name.toUpperCase());
  }
  for (const name of ['area: web', 'bugs', 'decisions', 'priority: high', 'status']) assert.equal(isManagedLabel(name), false, name);
});

test('each kind name gives trackerKind a kind, so the lock and the read agree', () => {
  for (const name of KIND_NAMES) assert.notEqual(trackerKind([name]), 'issue', name);
  assert.equal(trackerKind(['area: web', 'linked-work', 'status-queued']), 'issue');
});

test('trackerKind keeps its ranking when a ticket has several kind names', () => {
  assert.equal(trackerKind(['bug', 'feature', 'concept']), 'concept');
  assert.equal(trackerKind(['build', 'feature', 'decision-task']), 'decision');
  assert.equal(trackerKind(['improvement', 'feature', 'bug']), 'bug');
  assert.equal(trackerKind(['build', 'improvement', 'enhancement']), 'feature');
  assert.equal(trackerKind(['build', 'improvement']), 'improvement');
  assert.equal(trackerKind(['build']), 'build');
  assert.equal(trackerKind([], 'Product Backlog Item'), 'feature');
});

test('customLabelProblem and customTagProblem refuse every managed name', () => {
  for (const name of [...KIND_NAMES, ...STATUS_NAMES, 'linked-work']) {
    assert.match(customLabelProblem(name)!, /is reserved for/, name);
    assert.match(customTagProblem(name)!, /is reserved for/, name);
  }
  assert.equal(customLabelProblem('Defect'), "Defect is reserved for the item's kind.");
  assert.equal(customLabelProblem('status-queued'), 'status-queued is reserved for board status.');
  assert.equal(customLabelProblem('Linked-Work'), "Linked-Work is reserved for the factory's saved links.");
});

test("a row hides managed labels and keeps every other label in the ticket's order", () => {
  const labels = ['needs-triage', 'status-queued', 'Improvement', 'area: web', 'linked-work', 'decision-grill', 'Area: Server'];
  assert.deepEqual(shownLabels({ kind: 'improvement', labels }), ['needs-triage', 'area: web', 'Area: Server']);
});

test("a label mapped to a kind hides on rows of that kind only, without case", () => {
  const vocabulary = mapped('bug', 'type: defect');
  assert.deepEqual(shownLabels({ kind: 'bug', labels: ['Type: Defect', 'web'] }, vocabulary), ['web']);
  assert.deepEqual(shownLabels({ kind: 'feature', labels: ['Type: Defect', 'web'] }, vocabulary), ['Type: Defect', 'web']);
  assert.deepEqual(shownLabels({ kind: 'issue', labels: ['Type: Defect'] }, vocabulary), ['Type: Defect']);
});

test("a concept hides labels mapped to either concept term, and a build its own", () => {
  const { vocabulary } = effectiveVocabulary({ concept: { type: null, labels: ['epic'] }, 'concept-kind': { type: null, labels: ['idea'] }, build: { type: null, labels: ['delivery'] } });
  assert.deepEqual(shownLabels({ kind: 'concept', labels: ['epic', 'idea', 'delivery'] }, vocabulary), ['delivery']);
  assert.deepEqual(shownLabels({ kind: 'build', labels: ['epic', 'idea', 'delivery'] }, vocabulary), ['epic', 'idea']);
});

test('a row reads the first 100 labels a ticket has, before hiding any', () => {
  const labels = ['bug', ...Array.from({ length: 120 }, (_, n) => `area ${n}`)];
  const shown = shownLabels({ kind: 'bug', labels });
  assert.equal(shown.length, 99);
  assert.equal(shown.at(-1), 'area 98');
});
