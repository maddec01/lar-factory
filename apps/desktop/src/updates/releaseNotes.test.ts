import { assert, describe, it } from '@effect/vitest';

import { normalizeReleaseNotes } from './releaseNotes.ts';

/** A Release body as GitHub's generated notes write it: a "What's Changed" list of PR titles, oldest first. */
const body = (...titles: string[]) =>
    [
        "## What's Changed",
        ...titles.map((title, i) => `* ${title} by @maddec01 in https://github.com/maddec01/lar-factory/pull/${i + 1}`),
        '',
        '**Full Changelog**: https://github.com/maddec01/lar-factory/compare/v0.1.0...v0.2.0',
    ].join('\n');

describe('normalizeReleaseNotes', () => {
    it('gives each Release between the running version and the new one its changes, newest first', () => {
        const notes = normalizeReleaseNotes(
            [
                {
                    version: '0.4.0',
                    note: body('feat(board): show the changelog', 'fix(board): keep the header steady'),
                },
                { version: '0.3.0', note: body('<b>refactor</b>(board): split the &amp; store') },
                { version: '0.2.0', note: "## What's Changed\n\n**Full Changelog**: https://x/compare/a...b" },
            ],
            '0.4.0',
            'latest',
        );

        assert.deepStrictEqual(notes, {
            releaseNotes: [
                {
                    version: '0.4.0',
                    items: [
                        'fix(board): keep the header steady by @maddec01 in https://github.com/maddec01/lar-factory/pull/2',
                        'feat(board): show the changelog by @maddec01 in https://github.com/maddec01/lar-factory/pull/1',
                    ],
                    totalItems: 2,
                },
                {
                    version: '0.3.0',
                    items: [
                        'refactor(board): split the & store by @maddec01 in https://github.com/maddec01/lar-factory/pull/1',
                    ],
                    totalItems: 1,
                },
            ],
            omittedReleaseCount: 0,
        });
    });
});
