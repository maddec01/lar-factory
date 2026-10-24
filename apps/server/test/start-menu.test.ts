import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceOf, highlightedChoice, menuMove, readChoice, remembersChoice, startRequest, storedChoice } from '../src/start-menu.ts';
import type { ModelGroup } from '../src/model.ts';

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

test('Start remembers the picked choice once it reports "Started" or "May have started", not after a refusal or failure', () => {
  assert.equal(remembersChoice({ thread: { threadId: 't1', title: 'x' }, error: null }), true);
  assert.equal(remembersChoice({ thread: null, uncertain: true, error: 'could not be confirmed' }), true);
  assert.equal(remembersChoice({ thread: null, error: 'Start is not offered for that model choice.' }), false);
  assert.equal(remembersChoice({ thread: null, error: 'The board could not be reached.' }), false);
});

test('a stored choice reads back as it was stored; "T3 default" or anything unreadable reads as none', () => {
  const choice = { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' };
  assert.deepEqual(readChoice(storedChoice(choice)), choice);
  assert.equal(readChoice(storedChoice(undefined)), undefined);
  for (const raw of [null, '', 'not json', '42', '{"instanceId":"codex"}', '{"instanceId":1,"model":"gpt-5.5"}']) assert.equal(readChoice(raw), undefined, String(raw));
});

test('the menu highlights the remembered choice while it is offered, else "T3 default"', () => {
  const groups: ModelGroup[] = [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }];
  assert.deepEqual(highlightedChoice(groups, { instanceId: 'codex', model: 'gpt-5.5' }), { instanceId: 'codex', model: 'gpt-5.5' });
  assert.equal(highlightedChoice(groups, { instanceId: 'codex', model: 'gpt-4' }), undefined, 'model gone');
  assert.equal(highlightedChoice(groups, { instanceId: 'cursor', model: 'gpt-5.5' }), undefined, 'instance disabled');
  assert.equal(highlightedChoice([], { instanceId: 'codex', model: 'gpt-5.5' }), undefined, "T3's models can't be read");
  assert.equal(highlightedChoice(groups, undefined), undefined);
});
