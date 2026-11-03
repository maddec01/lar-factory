import { expect, test } from 'vite-plus/test';
import { nextTurn } from '../startup/loop-trace.ts';
import { oneAtATime } from './one-at-a-time.ts';

/** Work that takes three turns, noting each. */
const inTurns = (name: string, seen: string[]) => async () => {
  for (let turn = 1; turn <= 3; turn++) {
    seen.push(`${name} ${turn}`);
    await nextTurn();
  }
  return name;
};

test('work asked for while other work runs waits for it, so their turns never mix', async () => {
  const seen: string[] = [];
  const run = oneAtATime();
  const answers = await Promise.all([run(inTurns('a', seen)), run(inTurns('b', seen))]);
  expect(seen).toEqual(['a 1', 'a 2', 'a 3', 'b 1', 'b 2', 'b 3']);
  expect(answers).toEqual(['a', 'b']);
});

test('failed work still lets the next run, and its caller sees the failure', async () => {
  const seen: string[] = [];
  const run = oneAtATime();
  const failed = run(async () => { await nextTurn(); throw Error('read failed'); });
  const next = run(inTurns('b', seen));
  await expect(failed).rejects.toThrow('read failed');
  expect(await next).toBe('b');
});
