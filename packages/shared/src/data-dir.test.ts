import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { boardDataDir, DATA_DIR_ENV } from './data-dir.ts';

test('the data folder is in the home folder by default', () => {
  assert.equal(boardDataDir(undefined, { HOME: '/Users/someone' }), '/Users/someone/Library/Application Support/Lar Factory');
});

test('the data folder the app names wins over the environment home folder', () => {
  const env = { HOME: '/Users/agent-home', [DATA_DIR_ENV]: '/Users/app-user/Library/Application Support/Lar Factory' };
  assert.equal(boardDataDir(undefined, env), '/Users/app-user/Library/Application Support/Lar Factory');
});

test('a home folder passed in wins over the data folder the app names', () => {
  const env = { [DATA_DIR_ENV]: '/Users/app-user/Library/Application Support/Lar Factory' };
  assert.equal(boardDataDir('/Users/someone', env), '/Users/someone/Library/Application Support/Lar Factory');
});

test('an empty or relative data folder falls back to the home folder', () => {
  assert.equal(boardDataDir(undefined, { HOME: '/Users/someone', [DATA_DIR_ENV]: '' }), '/Users/someone/Library/Application Support/Lar Factory');
  assert.equal(boardDataDir(undefined, { HOME: '/Users/someone', [DATA_DIR_ENV]: 'data' }), '/Users/someone/Library/Application Support/Lar Factory');
});
