import { expect, test } from 'vite-plus/test';

import { nextTurn } from '../startup/loop-trace.ts';
import { oneAtATime, oneRunAndOneMore } from './one-at-a-time.ts';

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

test('asks made while the work runs start no second run beside it, only one more after it with their arguments combined', async () => {
    const seen: string[] = [];
    let release = () => {};
    const ask = oneRunAndOneMore(
        async (changed: boolean) => {
            seen.push(`start ${changed}`);
            await new Promise<void>((resolve) => (release = resolve));
            seen.push('end');
        },
        (a, b) => a || b,
    );
    const first = ask(false);

    expect(ask(true)).toBe(false);
    expect(ask(false)).toBe(false);
    expect(seen).toEqual(['start false']);

    release();
    await nextTurn();
    release();
    await first;

    expect(seen).toEqual(['start false', 'end', 'start true', 'end']);
});
