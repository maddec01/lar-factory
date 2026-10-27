import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKFLOW_LABELS, isKindLabel } from './workflow-labels.ts';

test("the workflow labels are the issue tracker's label setup list, in its order", () => {
  const doc = readFileSync(new URL('../../../skills/lar-work/issue-tracker.md', import.meta.url), 'utf8');
  const block = doc.split("<<'LABELS'\n")[1]!.split('\nLABELS')[0]!;
  assert.deepEqual(WORKFLOW_LABELS.map((l) => `${l.name}|${l.color}|${l.description}`), block.split('\n'));
});

test('the kinds are bug, feature, improvement and concept, not the decision, build or slice state labels', () => {
  assert.deepEqual(WORKFLOW_LABELS.map((l) => l.name).filter(isKindLabel), ['bug', 'feature', 'improvement', 'concept']);
  assert.equal(isKindLabel('Bug'), true, 'GitHub matches label names without case');
});
