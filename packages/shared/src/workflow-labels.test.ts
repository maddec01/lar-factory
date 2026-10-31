import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { WORKFLOW_LABELS, isKindLabel } from './workflow-labels.ts';

test('the kinds are bug, feature, improvement and concept, not the decision, build or slice state labels', () => {
  assert.deepEqual(WORKFLOW_LABELS.map((l) => l.name).filter(isKindLabel), ['bug', 'feature', 'improvement', 'concept']);
  assert.equal(isKindLabel('Bug'), true, 'GitHub matches label names without case');
});
