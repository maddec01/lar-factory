import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { customLabelProblem, customTagProblem, isKindLabel } from './custom-labels.ts';

test("a custom label may hold a colon, but gives no kind or Status and is not empty", () => {
  assert.equal(customLabelProblem('app: music'), null);
  assert.equal(customLabelProblem('active'), null, 'slice labels are no longer reserved');
  assert.match(customLabelProblem('  ')!, /name/);
  assert.equal(customLabelProblem('Build'), "Build is reserved for the item's kind.");
  assert.equal(customLabelProblem('decision-grill'), "decision-grill is reserved for the item's kind.");
  assert.match(customLabelProblem('status-review')!, /reserved for board status/);
  assert.equal(customLabelProblem('x'.repeat(50)), null);
  assert.equal(customLabelProblem('x'.repeat(51)), 'Use at most 50 characters. This name has 51.');
  assert.equal(customLabelProblem(' -R'), 'Do not start the label name with a hyphen.');
});

test('a custom tag is refused as a custom label is, and also when it holds a comma or semicolon', () => {
  assert.equal(customTagProblem('app: music'), null);
  assert.match(customTagProblem('Bug')!, /reserved for the item's kind/);
  assert.equal(customTagProblem('app, music'), 'Use a tag name without commas or semicolons.');
  assert.equal(customTagProblem('app; music'), 'Use a tag name without commas or semicolons.');
});

test('the kind labels are bug, feature, improvement and concept, in any case', () => {
  assert.deepEqual(['Bug', 'feature', 'IMPROVEMENT', 'concept', 'build', 'web'].map(isKindLabel), [true, true, true, true, false, false]);
});
