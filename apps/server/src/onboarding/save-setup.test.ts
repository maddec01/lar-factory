import { test, expect, type TestContext } from 'vite-plus/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPOSITORY_OPERATIONS } from '@lar-factory/shared';
import { readRepositoryList } from '../config/repository-config.ts';
import { readRepositorySetups, setOverride } from '../config/repository-settings.ts';
import { saveSetup, type SaveReads } from './save-setup.ts';

const repo = 'team/app';
const answers = { repo, projectId: 'app', itemSource: { kind: 'issues' }, domainDocs: { kind: 'off' }, skills: [] };
const allowed: SaveReads = { access: async () => Object.fromEntries(REPOSITORY_OPERATIONS.map((op) => [op, 'allowed'])) };
async function folder(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'local-setup-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('onboarding saves local settings, optional purpose and sharing on by default', async (t) => {
  const dir = await folder(t);
  expect(await saveSetup(answers, dir, allowed)).toEqual({ onboarding: [] });
  expect(readRepositorySetups(dir)[0]).toMatchObject({ repo, role: '', structureSync: true, domainDocs: { kind: 'off' } });
  const file = JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8'));
  expect(file.repositories[0].settings.structureSync).toBe(true);
  expect(file.repositories[0].settings).not.toHaveProperty('shared');
  setOverride(repo, 'domainDocs', { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' }, dir);
  setOverride(repo, 'domainDocs', undefined, dir);
  expect(readRepositorySetups(dir)[0]?.domainDocs).toEqual({ kind: 'off' });
});

test('onboarding with sync on and no mapping creates no labels', async (t) => {
  const dir = await folder(t);
  const created: string[] = [];
  const reads: SaveReads = { ...allowed, createLabel: async (_repo, name) => { created.push(name); return name; } };
  expect(await saveSetup({ ...answers, structureSync: true }, dir, reads)).toEqual({ onboarding: [] });
  expect(readRepositorySetups(dir)[0]?.structureSync).toBe(true);
  expect(created).toEqual([]);
});

test('onboarding persists each issue preference and defaults omitted preferences to on', async (t) => {
  const dir = await folder(t);
  await saveSetup(answers, dir, allowed);
  expect(readRepositorySetups(dir)[0]).toMatchObject({ createIssuesFromAddItem: true, createIssuesFromRetro: true, writeRefinedSpec: true });
  const chosen = await folder(t);
  expect(await saveSetup({ ...answers, createIssuesFromAddItem: false, createIssuesFromRetro: false, writeRefinedSpec: false }, chosen, allowed)).toEqual({ onboarding: [] });
  expect(readRepositorySetups(chosen)[0]).toMatchObject({ createIssuesFromAddItem: false, createIssuesFromRetro: false, writeRefinedSpec: false });
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    expect(await saveSetup({ ...answers, [key]: 'yes' }, dir, allowed)).toMatchObject({ status: 400 });
  }
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

test('invalid source or sharing values change no local settings', async (t) => {
  const dir = await folder(t);
  for (const change of [{ structureSync: 'yes' }, { domainDocs: { kind: 'repository' } }, { itemSource: { kind: 'azure-board', team: 'Team' } }]) {
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

test('onboarding needs no consent payload and persists no consent list', async (t) => {
  const dir = await folder(t);
  const input = answers;
  expect(await saveSetup(input, dir, allowed)).toEqual({ onboarding: [] });
  expect(await readFile(join(dir, 'repository-settings.json'), 'utf8')).not.toContain('consent');
});

 test('onboarding refuses malformed vocabulary before saving', async (t) => {
  const dir = await folder(t);
  expect(await saveSetup({ ...answers, vocabulary: { bug: { type: null, labels: [42] } } }, dir, allowed)).toMatchObject({ status: 400 });
  expect(readRepositoryList(dir)).toEqual([]);
});

const vocabularyReads = {
  github: async (path: string) => path.endsWith('/labels?per_page=100') ? [[{ name: 'bug' }]] : [{ owner: { type: 'User' } }],
  azure: async () => ({ value: [{ name: 'Bug' }] }),
};
test('onboarding saves existing vocabulary and explicit none using read-only discovery', async (t) => {
  const dir = await folder(t);
  const vocabulary = { bug: { type: null, labels: ['bug'] }, feature: { type: null, labels: [] } };
  expect(await saveSetup({ ...answers, vocabulary }, dir, { ...allowed, vocabulary: vocabularyReads })).toEqual({ onboarding: [] });
  expect(readRepositorySetups(dir)[0]?.vocabulary.bug).toEqual(vocabulary.bug);
  expect(readRepositorySetups(dir)[0]?.vocabularySources.feature).toBe('local');
});
test('onboarding refuses missing terms and unverified field access before persistence', async (t) => {
  for (const labels of [['missing'], ['bug']]) {
    const dir = await folder(t);
    expect(await saveSetup({ ...answers, structureSync: false, vocabulary: { bug: { type: null, labels } } }, dir,
      { access: async () => ({}), vocabulary: vocabularyReads })).toMatchObject({ status: labels[0] === 'missing' ? 400 : 403 });
    expect(readRepositoryList(dir)).toEqual([]);
  }
});

test('onboarding refuses linked-work typed as a new label and saves nothing', async (t) => {
  const dir = await folder(t);
  const calls: string[] = [];
  const reads: SaveReads = { ...allowed, vocabulary: { github: async (path) => path.includes('/labels') ? [] : { owner: { type: 'User' } }, azure: async () => ({ value: [] }) }, createLabel: async (_repo, name) => { calls.push(name); return name; } };
  expect(await saveSetup({ ...answers, structureSync: false, newLabels: { bug: ['linked-work'] } }, dir, reads)).toEqual({ status: 409, error: "linked-work is reserved for the factory's saved links." });
  expect(calls).toEqual([]);
  expect(readRepositorySetups(dir)).toEqual([]);
});

test('explicit labels save with sharing off and failed creation saves no mapping', async (t) => {
  const dir = await folder(t);
  const calls: string[] = [];
  const reads: SaveReads = { ...allowed, vocabulary: { github: async (path) => path.includes('/labels') ? [] : { owner: { type: 'User' } }, azure: async () => ({ value: [] }) }, createLabel: async (_repo, name) => { calls.push(name); return name; } };
  expect(await saveSetup({ ...answers, structureSync: false, newLabels: { bug: ['triage'] } }, dir, reads)).toEqual({ onboarding: [] });
  expect(calls).toEqual(['triage']);
  expect(readRepositorySetups(dir)[0]?.vocabulary.bug.labels).toEqual(['triage']);
  const failed = await saveSetup({ ...answers, structureSync: false, newLabels: { bug: ['broken'] } }, dir, { ...reads, createLabel: async () => { throw new Error('Provider denied creation; recheck label access.'); } });
  expect(failed).toMatchObject({ status: 409, error: expect.stringContaining('recheck label access') });
  expect(readRepositorySetups(dir)[0]?.vocabulary.bug.labels).toEqual(['triage']);
});
