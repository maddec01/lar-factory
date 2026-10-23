import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceOf, menuMove, startRequest } from '../src/start-menu.ts';

test('picking "T3 default" posts no model choice; picking a model posts its instance id and slug', () => {
  assert.deepEqual(startRequest('s1', 'PVTI_1', choiceOf({})), { session: 's1', itemId: 'PVTI_1' });
  assert.deepEqual(startRequest('s1', 'PVTI_1', choiceOf({ instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' })),
    { session: 's1', itemId: 'PVTI_1', model: { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' } });
});

test('an entry missing its instance or its model is "T3 default"', () => {
  assert.equal(choiceOf({ instanceId: 'codex' }), undefined);
  assert.equal(choiceOf({ model: 'gpt-5.5' }), undefined);
});

test('arrow keys move through the menu and wrap; Home and End go to its ends; other keys are not its own', () => {
  assert.equal(menuMove('ArrowDown', 0, 4), 1);
  assert.equal(menuMove('ArrowDown', 3, 4), 0);
  assert.equal(menuMove('ArrowUp', 0, 4), 3);
  assert.equal(menuMove('ArrowUp', 2, 4), 1);
  assert.equal(menuMove('Home', 2, 4), 0);
  assert.equal(menuMove('End', 1, 4), 3);
  assert.equal(menuMove('Enter', 1, 4), null);
  assert.equal(menuMove('a', 1, 4), null);
});
