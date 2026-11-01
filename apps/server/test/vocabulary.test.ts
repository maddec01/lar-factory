import { expect, test } from 'vite-plus/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBoard, writesRepository } from './server-support.ts';

const repo = 'team/app';
const choices = { labels: ['bug', 'feature'], types: ['Task'] };
const answers = { repo, projectId: 'app', structureSync: false, itemSource: { kind: 'issues' }, domainDocs: { kind: 'off' }, skills: [] };

test('vocabulary discovery suggests existing labels; untouched onboarding and explicit none make no provider writes', async (t) => {
  const board = await startBoard(t, { repositories: [], vocabulary: choices });
  const read = await board.post({ repo }, board.url, '/api/onboarding/vocabulary');
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ discovery: { types: { state: 'available', choices: ['Task'] } }, suggestions: { bug: { type: null, labels: ['bug'] } } });
  const saved = await board.post(answers, board.url, '/api/onboarding/setup');
  expect(saved.status).toBe(200);
  const none = await board.post({ repo, change: 'vocabulary', key: 'bug', value: { type: null, labels: [] } }, board.url, '/api/repositories/settings');
  expect(await none.json()).toMatchObject({ setup: { vocabulary: { bug: { type: null, labels: [] } }, vocabularySources: { bug: 'local' } } });
  expect((await board.calls()).filter(writesRepository)).toEqual([]);
});

test('Settings creates only explicitly saved labels and keeps its old mapping after a provider failure', async (t) => {
  const options = { repositories: [repo], vocabulary: choices };
  const board = await startBoard(t, options);
  const save = (name: string) => board.post({ repo, change: 'vocabulary', key: 'improvement', value: { type: 'Task', labels: ['feature'] }, newLabels: [name] }, board.url, '/api/repositories/settings');
  const saved = await save('triage');
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ setup: { vocabulary: { improvement: { type: 'Task', labels: ['feature', 'triage'] } } } });
  await board.update({ ...options, vocabulary: { ...choices, failCreate: true } });
  const before = await readFile(join(board.dataDir, 'repository-settings.json'), 'utf8');
  const failed = await save('blocked');
  expect(failed.status).toBe(400);
  expect(await failed.json()).toMatchObject({ error: expect.stringContaining('Label creation refused') });
  expect(await readFile(join(board.dataDir, 'repository-settings.json'), 'utf8')).toBe(before);
});

test('onboarding creates a typed label only on explicit save and refuses unverified Access', async (t) => {
  const board = await startBoard(t, { repositories: [], vocabulary: choices });
  const saved = await board.post({ ...answers, vocabulary: { bug: { type: null, labels: ['bug'] } }, newLabels: { bug: ['triage'] } }, board.url, '/api/onboarding/setup');
  expect(saved.status).toBe(200);
  const local = JSON.parse(await readFile(join(board.dataDir, 'repository-settings.json'), 'utf8'));
  expect(local.repositories[0].settings.overrides.vocabulary.bug).toEqual({ type: null, labels: ['bug', 'triage'] });
  const denied = await startBoard(t, { repositories: [], vocabulary: choices, oauthScopes: null });
  const refused = await denied.post({ ...answers, newLabels: { feature: ['triage'] } }, denied.url, '/api/onboarding/setup');
  expect(refused.status).toBe(409);
  expect((await refused.json() as { error: string }).error).toMatch(/not checked yet/);
  expect((await denied.calls()).filter(writesRepository)).toEqual([]);
});

test('refused metadata reads expose their reason and still allow an explicit empty mapping', async (t) => {
  const board = await startBoard(t, { repositories: [repo], vocabulary: { ...choices, readFails: true } });
  const read = await board.post({ repo, change: 'discover-vocabulary' }, board.url, '/api/repositories/settings');
  expect(await read.json()).toMatchObject({ discovery: { types: { state: 'refused', reason: expect.stringContaining('Metadata read refused') }, labels: { state: 'refused' } } });
  const none = await board.post({ repo, change: 'vocabulary', key: 'feature', value: { type: null, labels: [] } }, board.url, '/api/repositories/settings');
  expect(none.status).toBe(200);
  const forbidden = await board.post({ repo, change: 'vocabulary', key: 'feature', value: { type: 'Task', labels: [] } }, board.url, '/api/repositories/settings');
  expect(forbidden.status).toBe(400);
  expect((await board.calls()).filter(writesRepository)).toEqual([]);
});

test('Recheck finds label management for a saved setup that never had it, and onboarding saves it', async (t) => {
  const board = await startBoard(t, { repositories: [repo], vocabulary: choices });
  const file = join(board.dataDir, 'repository-settings.json');
  const upgraded = JSON.parse(await readFile(file, 'utf8'));
  delete upgraded.repositories[0].settings.access['manage-labels'];
  await writeFile(file, JSON.stringify(upgraded));
  const read = await board.post({ repo, change: 'discover-vocabulary' }, board.url, '/api/repositories/settings');
  expect(await read.json()).toMatchObject({ setup: { access: { 'manage-labels': 'unverified' } } });
  const rechecked = await board.post({ repo, change: 'recheck' }, board.url, '/api/repositories/settings');
  expect(await rechecked.json()).toMatchObject({ setup: { access: { 'manage-labels': 'allowed' } } });

  const fresh = await startBoard(t, { repositories: [], vocabulary: choices });
  expect((await fresh.post(answers, fresh.url, '/api/onboarding/setup')).status).toBe(200);
  const local = JSON.parse(await readFile(join(fresh.dataDir, 'repository-settings.json'), 'utf8'));
  expect(local.repositories[0].settings.access['manage-labels']).toBe('allowed');
});
