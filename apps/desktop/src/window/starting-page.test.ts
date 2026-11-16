import { assert, describe, it } from '@effect/vitest';

import * as LaunchSecret from '../board-server/launch-secret.ts';
import * as StartingPage from './starting-page.ts';

describe('StartingPage messages', () => {
    // Runs a message in a stand-in for the page and returns what it called.
    const run = (script: string) => {
        const calls: Array<[string, string]> = [];

        // oxlint-disable-next-line typescript/no-implied-eval -- runs the starting page's own script in a stand-in window
        new Function('window', script)({
            larLoading: {
                step: (text: string) => calls.push(['step', text]),
                error: (text: string) => calls.push(['error', text]),
            },
        });

        return calls;
    };

    it("sends why a start failed as the page's error line, whatever characters the reason holds", () => {
        const reason = `the board server exited with code 1 <before> "it" reported a port `;

        assert.deepEqual(run(StartingPage.errorScript(reason)), [
            ['error', `The board server didn't start: ${reason}. Trying again.`],
        ]);
    });
});

describe('StartingPage.boardUrl', () => {
    it('keeps a URL the launch secret still goes to', () => {
        const secret = 's3cret';
        const href = StartingPage.boardUrl(new URL('http://127.0.0.1:4317/'));

        assert.equal(LaunchSecret.forFrame(href, 'http://127.0.0.1:4317', secret), secret);
    });
});
