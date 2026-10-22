import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { factoryRepo, testEnv } from './repo-support.ts';

test('git variables inherited from a hook or rebase --exec never reach the real repo', async (t) => {
  const decoy = await mkdtemp(join(tmpdir(), 'mux decoy repo '));
  t.after(() => rm(decoy, { recursive: true, force: true }));
  execFileSync('git', ['init', '--bare', decoy], { env: testEnv(), stdio: 'ignore' });
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = decoy;
  process.env.GIT_WORK_TREE = decoy;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  assert.equal(testEnv().GIT_DIR, undefined);
  const f = await factoryRepo(t);
  assert.equal(f.git('log', '-1', '--format=%s'), 'feat(board): initial fixture');
  const decoyRefs = execFileSync('git', ['--git-dir', decoy, 'for-each-ref'], { env: testEnv(), encoding: 'utf8' });
  assert.equal(decoyRefs, '');
});
