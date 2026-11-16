import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as NodeFS from 'node:fs';
import * as NodePath from 'node:path';

import { tempDir } from '../../test/support.ts';
import * as T3Instances from './t3-instances.ts';

/** A PATH whose `t3` prints its arguments and exits with `code`. */
const fakeT3 = (code: number) => {
    const bin = tempDir('fake-t3-');

    NodeFS.writeFileSync(NodePath.join(bin, 't3'), `#!/bin/sh\necho "$@"\nexit ${code}\n`, { mode: 0o755 });

    return { PATH: bin };
};

describe('runT3', () => {
    it.live('runs t3 from the given PATH and gives its output and exit code', () =>
        Effect.gen(function* () {
            const run = T3Instances.runT3(fakeT3(0));
            const answer = yield* Effect.promise(() => run(['auth', 'session'], new AbortController().signal));

            assert.deepStrictEqual(answer, { code: 0, stdout: 'auth session\n' });

            const failed = yield* Effect.promise(() => T3Instances.runT3(fakeT3(3))([], new AbortController().signal));

            assert.strictEqual(failed.code, 3);
        }),
    );
});
