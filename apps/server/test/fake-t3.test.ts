import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const [message, title] of [
  ['a'.repeat(79), 'a'.repeat(79)],
  ['a'.repeat(80), 'a'.repeat(80)],
  ['a'.repeat(81), 'a'.repeat(79) + '…'],
  ['a'.repeat(78) + '  tail', 'a'.repeat(78) + '…'],
  [' \n  First line  \nSecond line ', 'First line'],
  ['a'.repeat(78) + '😀x', 'a'.repeat(78) + '\ud83d…'],
] as const) {
  test(`fake T3 titles ${JSON.stringify(message)}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-t3-title-'));
    try {
      const state = join(dir, 'state.json');
      writeFileSync(state, JSON.stringify({ t3: { recover: 'late', firstMessage: message } }));
      const call = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ['test/fake-t3.cjs', 'thread', ...args], {
        env: { ...process.env, FAKE_GH_STATE: state }, encoding: 'utf8',
      }));
      assert.equal(call('start', '--message', message).title, title);
      assert.equal(call('list')[0].title, title);
      assert.equal(call('show', 'thread-1').messages[0].text, message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
