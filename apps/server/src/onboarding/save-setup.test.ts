import { test, expect, type TestContext } from 'vite-plus/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPOSITORY_OPERATIONS } from '@lar-factory/shared';
import { readRepositoryList } from '../config/repository-config.ts';
import { readRepositorySetups, setOverride } from '../config/repository-settings.ts';
import { saveSetup, type SaveReads } from './save-setup.ts';

const repo = 'team/app';
const answers = { repo, projectId: 'app', itemSource: { kind: 'issues' }, domainDocs: { kind: 'private' }, skills: [], consent: [] };
const allowed: SaveReads = { access: async () => Object.fromEntries(REPOSITORY_OPERATIONS.map((op) => [op, 'allowed'])) };
async function folder(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'local-setup-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('onboarding saves local settings, optional purpose and sharing on by default', async (t) => {
  const dir = await folder(t);
  expect(await saveSetup(answers, dir, allowed)).toEqual({ onboarding: [] });
  expect(readRepositorySetups(dir)[0]).toMatchObject({ repo, role: '', structureSync: true, domainDocs: { kind: 'private' } });
  const file = JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8'));
  expect(file.repositories[0].settings.structureSync).toBe(true);
  expect(file.repositories[0].settings).not.toHaveProperty('shared');
  setOverride(repo, 'domainDocs', { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' }, dir);
  setOverride(repo, 'domainDocs', undefined, dir);
  expect(readRepositorySetups(dir)[0]?.domainDocs).toEqual({ kind: 'private' });
});

test('GitHub sharing checks creation, comments and its discovery label before saving', async (t) => {
  const dir = await folder(t);
  const result = await saveSetup(answers, dir, { access: async () => ({ 'publish-ticket': 'allowed', 'edit-ticket': 'refused' }) });
  expect(result).toMatchObject({ status: 403, error: expect.stringContaining('post comments, set issue labels') });
  expect(readRepositoryList(dir)).toEqual([]);
  expect(await saveSetup({ ...answers, structureSync: false }, dir, { access: async () => ({}) })).toEqual({ onboarding: [] });
  expect(readRepositorySetups(dir)[0]?.structureSync).toBe(false);
});

test('failed access checks block sharing but allow local shaping when sharing is off', async (t) => {
  const dir = await folder(t);
  const reads: SaveReads = { access: async () => { throw new Error('Not signed in'); } };
  expect(await saveSetup(answers, dir, reads)).toMatchObject({ status: 403 });
  expect(await saveSetup({ ...answers, structureSync: false }, dir, reads)).toEqual({ onboarding: [] });
  expect(readRepositorySetups(dir)[0]?.access['push-branch']).toBe('unverified');
});

test('invalid source, consent or sharing values change no local settings', async (t) => {
  const dir = await folder(t);
  for (const change of [{ structureSync: 'yes' }, { consent: ['merge'] }, { domainDocs: { kind: 'repository' } }, { itemSource: { kind: 'azure-board', team: 'Team' } }]) {
    expect(await saveSetup({ ...answers, ...change }, dir, allowed)).toMatchObject({ status: 400 });
  }
  expect(readRepositoryList(dir)).toEqual([]);
});

test('Azure onboarding saves its selected team without writing to Azure', async (t) => {
  const dir = await folder(t);
  expect(await saveSetup({ ...answers, repo: 'org/project/app', structureSync: false, itemSource: { kind: 'azure-board', team: 'App Team' } }, dir, { access: async () => ({}) })).toEqual({ onboarding: [] });
  expect(readRepositorySetups(dir)[0]?.itemSource).toEqual({ kind: 'azure-board', team: 'App Team' });
});

test('a refused list read stops onboarding before saving anything', async (t) => {
  const dir = await folder(t);
  const result = await saveSetup({ ...answers, structureSync: false }, dir, { ...allowed, source: async () => { throw new Error('Read work items denied'); } });
  expect(result).toEqual({ status: 403, error: "Can't read the selected issue list. Read work items denied" });
  expect(readRepositoryList(dir)).toEqual([]);
});
