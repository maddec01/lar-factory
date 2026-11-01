import { test, expect, vi, type TestContext } from 'vite-plus/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOnboardedConfigs, readRepositorySetups, changeRepositorySettings } from './repository-settings.ts';
import { saveOnboarded } from './repository-config.ts';

async function folder(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'local-settings-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('board reads only local overrides and makes no provider calls', async (t) => {
  const dir = await folder(t);
  await writeFile(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: [{ repo: 'team/app', settings: {
    overrides: { role: 'Application', skills: ['test'] }, shared: { role: 'Old shared role', labels: ['old'] }, sharedProblem: 'Old warning', accepted: { itemSource: { kind: 'issues' }, domainDocs: { kind: 'repository', glossary: 'OLD.md', adrs: 'old' } },
  } }] }));
  let calls = 0;
  const result = await readOnboardedConfigs([{ repo: 'team/app' }], async () => { calls++; throw new Error('No network'); }, dir);
  expect(calls).toBe(0);
  expect(result.problems).toEqual([]);
  expect(result.setups[0]).toMatchObject({ role: 'Application', labels: [], skills: ['test'], structureSync: true });
  expect(result.setups[0]).not.toHaveProperty('shared');
  expect(result.setups[0]).not.toHaveProperty('paused');
});

test('local settings validate values and reset to factory defaults', async (t) => {
  const dir = await folder(t);
  saveOnboarded('team/app', null, dir);
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'role', value: 'App' }, dir)).toMatchObject({ setup: { role: 'App' } });
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'role' }, dir)).toMatchObject({ setup: { role: '' } });
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'skills', value: 'all' }, dir)).toMatchObject({ status: 400 });
  expect(await changeRepositorySettings({ repo: 'else/app', change: 'override', key: 'role', value: 'X' }, dir)).toMatchObject({ status: 409 });
  expect(readRepositorySetups(dir)[0]?.role).toBe('');
});

test('Settings persists issue preferences independently and rejects invalid values', async (t) => {
  const dir = await folder(t);
  saveOnboarded('team/app', null, dir);
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec'] as const) {
    expect(readRepositorySetups(dir)[0]?.[key]).toBe(true);
    expect(await changeRepositorySettings({ repo: 'team/app', change: 'override', key, value: false }, dir)).toMatchObject({ setup: { [key]: false } });
    expect(readRepositorySetups(dir)[0]?.[key]).toBe(false);
    expect(await changeRepositorySettings({ repo: 'team/app', change: 'override', key, value: 'on' }, dir)).toMatchObject({ status: 400 });
  }
  await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'createIssuesFromAddItem' }, dir);
  expect(readRepositorySetups(dir)[0]).toMatchObject({ createIssuesFromAddItem: true, createIssuesFromRetro: false, writeRefinedSpec: false });
});

test('Azure read-only is exposed for this session without changing saved choices or GitHub', async (t) => {
  const dir = await folder(t);
  saveOnboarded('organization/project/repository', null, dir);
  saveOnboarded('team/app', null, dir);
  const before = await readFile(join(dir, 'repository-settings.json'), 'utf8');
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  expect(readRepositorySetups(dir)[0]).toMatchObject({ azureReadOnly: true, createIssuesFromAddItem: true });
  expect(readRepositorySetups(dir)[1]?.azureReadOnly).not.toBe(true);
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '0');
  expect(readRepositorySetups(dir)[0]?.azureReadOnly).not.toBe(true);
  expect(await readFile(join(dir, 'repository-settings.json'), 'utf8')).toBe(before);
});

test('legacy private domain docs read as off and save as on or off', async (t) => {
  const dir = await folder(t);
  await writeFile(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: [{ repo: 'team/app', settings: { overrides: { domainDocs: { kind: 'private' } } } }] }));
  expect(readRepositorySetups(dir)[0]?.domainDocs).toEqual({ kind: 'off' });
  await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'domainDocs', value: { kind: 'off' } }, dir);
  expect(await readFile(join(dir, 'repository-settings.json'), 'utf8')).not.toContain('private');
});

test('changing docs applies directly and leaves no acceptance gate', async (t) => {
  const dir = await folder(t);
  saveOnboarded('team/app', null, dir);
  await changeRepositorySettings({ repo: 'team/app', change: 'override', key: 'domainDocs', value: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' } }, dir);
  expect(readRepositorySetups(dir)[0]?.domainDocs.kind).toBe('repository');
  expect(JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8')).repositories[0].settings).not.toHaveProperty('accepted');
});

test('sharing cannot be enabled with unchecked access', async (t) => {
  const dir = await folder(t);
  saveOnboarded('team/app', null, dir);
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'structure-sync', value: false }, dir)).toMatchObject({ setup: { structureSync: false } });
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'structure-sync', value: true }, dir)).toMatchObject({ status: 400 });
  expect(readRepositorySetups(dir)[0]?.structureSync).toBe(false);
});

test('vocabulary rejects malformed mappings before provider reads', async (t) => {
  const dir = await folder(t);
  saveOnboarded('team/app', null, dir);
  for (const value of [null, {}, { type: null, labels: [''] }, { type: null, labels: [], extra: true }]) {
    expect(await changeRepositorySettings({ repo: 'team/app', change: 'vocabulary', key: 'bug', value }, dir)).toMatchObject({ status: 400 });
  }
  expect(readRepositorySetups(dir)[0]?.vocabulary.bug).toEqual({ type: null, labels: [] });
});

test('vocabulary discovery reads existing terms and saving requires field access', async (t) => {
  const dir = await folder(t);
  saveOnboarded('team/app', null, dir);
  const reads = { github: async (path: string) => path === 'repos/team/app' ? { owner: { type: 'Organization' } } : [[{ name: 'bug' }]], azure: async () => { throw new Error('Unexpected Azure read'); } };
  const before = await readFile(join(dir, 'repository-settings.json'), 'utf8');
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'discover-vocabulary' }, dir, reads)).toMatchObject({ discovery: { labels: { state: 'available', choices: ['bug'] } } });
  expect(await readFile(join(dir, 'repository-settings.json'), 'utf8')).toBe(before);
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'vocabulary', key: 'bug', value: { type: null, labels: ['bug'] } }, dir, reads)).toMatchObject({ status: 400 });
  expect(await changeRepositorySettings({ repo: 'team/app', change: 'vocabulary', key: 'bug', value: { type: null, labels: [] } }, dir, reads)).toMatchObject({ setup: { vocabularySources: { bug: 'local' } } });
});

test('Settings persists created labels only after provider success', async (t) => {
  const dir = await folder(t);
  saveOnboarded('team/app', null, dir);
  const { replaceAccess } = await import('@lar-factory/shared/repository-settings');
  replaceAccess('team/app', { 'tag-ticket': 'allowed' }, dir);
  const reads = { github: async (path: string) => path.includes('/labels') ? [] : { owner: { type: 'User' } }, azure: async () => ({ value: [] }) };
  const request = { repo: 'team/app', change: 'vocabulary', key: 'bug', value: { type: null, labels: [] }, newLabels: ['triage'] };
  expect(await changeRepositorySettings(request, dir, reads, async () => { throw new Error('Label creation denied'); })).toMatchObject({ status: 400 });
  expect(readRepositorySetups(dir)[0]?.vocabulary.bug.labels).toEqual([]);
  expect(await changeRepositorySettings(request, dir, reads, async (_repo, name) => name)).toMatchObject({ setup: { vocabulary: { bug: { labels: ['triage'] } } } });
});
