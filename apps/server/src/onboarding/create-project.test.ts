import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import type { ProjectChoice } from '@lar-factory/shared';
import { createProject } from './create-project.ts';

/** A home with an empty folder `lar-web` in it. */
function home(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'lar-create-home-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'lar-web'));
  return dir;
}

const choice = (id: string, folder: string): ProjectChoice =>
  ({ id, name: id, folder, repo: `maddec01/${id}`, provider: 'GitHub', hasConfig: false, onBoard: false });

test('adds the folder to T3 and answers with T3\'s projects and the new one\'s id', async (t) => {
  const dir = home(t);
  const added: string[] = [];
  const projects = [choice('notes', '/elsewhere'), choice('lar-web', join(dir, 'lar-web'))];
  const answer = await createProject({ folder: '~/lar-web/' }, async () => projects, { HOME: dir },
    async (folder) => { added.push(folder); return null; });
  assert.deepEqual(added, [join(dir, 'lar-web')]);
  assert.deepEqual(answer, { projects, projectId: 'lar-web' });
});

test('finds the new project when T3 keeps the folder by another path to it', async (t) => {
  const dir = home(t);
  symlinkSync(join(dir, 'lar-web'), join(dir, 'link'));
  const projects = [choice('lar-web', join(dir, 'lar-web'))];
  const answer = await createProject({ folder: join(dir, 'link') }, async () => projects, { HOME: dir }, async () => null);
  assert.deepEqual(answer, { projects, projectId: 'lar-web' });
});

test('a folder that is missing, relative or no folder is refused before T3 runs', async (t) => {
  const dir = home(t);
  let ran = false;
  const add = async () => { ran = true; return null; };
  const create = (folder: unknown) => createProject({ folder }, async () => [], { HOME: dir }, add);
  assert.deepEqual(await create(undefined), { status: 400, error: 'Name the folder to add.' });
  assert.deepEqual(await create('  '), { status: 400, error: 'Name the folder to add.' });
  assert.deepEqual(await create('lar-web'), { status: 400, error: 'Give the folder\'s full path, such as ~/Developer/lar-web.' });
  assert.deepEqual(await create(join(dir, 'nope')), { status: 400, error: `There is no folder at ${join(dir, 'nope')}.` });
  assert.equal(ran, false);
});

test('a failing t3 project add answers with its message', async (t) => {
  const dir = home(t);
  const answer = await createProject({ folder: join(dir, 'lar-web') }, async () => [], { HOME: dir },
    async () => 't3 could not add the project: Could not reach the T3 Code server.');
  assert.deepEqual(answer, { status: 502, error: 't3 could not add the project: Could not reach the T3 Code server.' });
});

test('a project T3 doesn\'t list after adding it, or projects that can\'t be read, answer with the problem', async (t) => {
  const dir = home(t);
  const folder = join(dir, 'lar-web');
  assert.deepEqual(await createProject({ folder }, async () => [choice('notes', '/elsewhere')], { HOME: dir }, async () => null),
    { status: 502, error: `T3 Code added ${folder}, but its projects don't list it.` });
  assert.deepEqual(await createProject({ folder }, async () => { throw new Error("Can't read T3 Code's projects at /x"); }, { HOME: dir }, async () => null),
    { status: 502, error: "Can't read T3 Code's projects at /x" });
});
