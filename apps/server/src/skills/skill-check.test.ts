import type { SkillCheckRequest } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vite-plus/test';

import { parentSkillCheck } from './skill-check.ts';

/** A parent that records each request, and answers it when the test says. */
function fakeParent() {
    const sent: SkillCheckRequest[] = [];
    const parent = Object.assign(new EventEmitter(), {
        connected: true,
        send: (message: SkillCheckRequest) => sent.push(message) > 0,
    });
    const answer = (id: number, refusal: string | null, drift?: string[]) =>
        parent.emit('message', { type: 'skills-checked', id, refusal, ...(drift && { drift }) });

    return { parent, sent, answer };
}

test('each check resolves with the answer to its own request', async () => {
    const { parent, sent, answer } = fakeParent();
    const check = parentSkillCheck({ BOARD_SKILL_CHECK: '1' }, parent)!;
    const first = check();
    const second = check();

    assert.deepEqual(sent, [
        { type: 'check-skills', id: 0 },
        { type: 'check-skills', id: 1 },
    ]);
    answer(1, 'blocked');
    answer(0, null);
    assert.deepEqual(await Promise.all([first, second]), [{ refusal: null }, { refusal: 'blocked' }]);
});
