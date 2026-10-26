import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { SkillCheckRequest } from '@lar-factory/shared';
import { parentSkillCheck } from './skill-check.ts';

/** A parent that records each request, and answers it when the test says. */
function fakeParent() {
  const sent: SkillCheckRequest[] = [];
  const parent = Object.assign(new EventEmitter(), {
    connected: true,
    send: (message: SkillCheckRequest) => sent.push(message) > 0,
  });
  const answer = (id: number, refusal: string | null) => parent.emit('message', { type: 'skills-checked', id, refusal });
  return { parent, sent, answer };
}

test('without the environment flag or an IPC channel there is no skill check', () => {
  assert.equal(parentSkillCheck({}, fakeParent().parent), undefined);
  assert.equal(parentSkillCheck({ BOARD_SKILL_CHECK: '1' }, new EventEmitter()), undefined);
});

test('each check resolves with the answer to its own request', async () => {
  const { parent, sent, answer } = fakeParent();
  const check = parentSkillCheck({ BOARD_SKILL_CHECK: '1' }, parent)!;
  const first = check();
  const second = check();
  assert.deepEqual(sent, [{ type: 'check-skills', id: 0 }, { type: 'check-skills', id: 1 }]);
  answer(1, 'blocked');
  answer(0, null);
  assert.deepEqual(await Promise.all([first, second]), [null, 'blocked']);
});

test('a check refuses when the parent is gone or leaves before it answers', async () => {
  const { parent } = fakeParent();
  const check = parentSkillCheck({ BOARD_SKILL_CHECK: '1' }, parent)!;
  const pending = check();
  parent.connected = false;
  parent.emit('disconnect');
  assert.match((await pending)!, /didn't answer/);
  assert.match((await check())!, /didn't answer/);
});
