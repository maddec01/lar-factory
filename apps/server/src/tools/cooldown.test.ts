import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { createCooldown } from './cooldown.ts';

test('a rate limit holds every call back until the limit resets', async () => {
    const cooldown = createCooldown('gh', async () => 10_000);

    cooldown.check(0);
    await cooldown.failed('gh: API rate limit exceeded for user ID 1.', 1_000);
    assert.throws(() => cooldown.check(9_999), /gh is rate limited/);
    assert.equal(cooldown.until(9_999), 10_000);
    cooldown.check(10_000);
    assert.equal(cooldown.until(10_000), 0);
});
