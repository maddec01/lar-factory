import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { boardDataDir, DATA_DIR_ENV } from './data-dir.ts';

test('the data folder is in the home folder by default', () => {
    assert.equal(
        boardDataDir(undefined, { HOME: '/Users/someone' }),
        '/Users/someone/Library/Application Support/Lar Factory',
    );
});

test('the data folder the app names wins over the environment home folder', () => {
    const env = {
        HOME: '/Users/agent-home',
        [DATA_DIR_ENV]: '/Users/app-user/Library/Application Support/Lar Factory',
    };

    assert.equal(boardDataDir(undefined, env), '/Users/app-user/Library/Application Support/Lar Factory');
});
