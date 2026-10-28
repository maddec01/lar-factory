import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
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

test('a rate limit without a known reset backs off for a minute, then twice as long each time', async () => {
  const cooldown = createCooldown('az');
  await cooldown.failed('TF400733: The request has been canceled', 0);
  assert.equal(cooldown.until(0), 60_000);
  await cooldown.failed('HTTP 429 Too Many Requests', 60_000);
  assert.equal(cooldown.until(60_000), 180_000);
  cooldown.succeeded();
  await cooldown.failed('HTTP 429', 200_000);
  assert.equal(cooldown.until(200_000), 260_000, 'a call that went through starts the backoff over');
});

test('any other failure starts no cooldown', async () => {
  const cooldown = createCooldown('gh', async () => 10_000);
  await cooldown.failed('HTTP 404: Not Found', 0);
  assert.equal(cooldown.until(0), 0);
});
