import { expect, test } from 'vite-plus/test';
import { discoverVocabulary, type VocabularyReads } from './publication-settings.ts';

const available: VocabularyReads = {
  github: async (path) => path.endsWith('/issue-types') ? [{ name: 'Bug' }, { name: 'Task' }] : path.includes('/labels') ? [{ name: 'backend' }] : { owner: { type: 'Organization' } },
  azure: async (_repo, resource) => ({ value: resource === 'workitemtypes' ? [{ name: 'User Story' }] : [{ name: 'backend' }] }),
};

test('provider discovery returns only detected terms and distinguishes an empty list', async () => {
  expect(await discoverVocabulary('org/repo', available)).toEqual({ provider: 'github', types: { state: 'available', choices: ['Bug', 'Task'] }, labels: { state: 'available', choices: ['backend'] } });
  expect(await discoverVocabulary('org/project/repo', available)).toEqual({ provider: 'azure', types: { state: 'available', choices: ['User Story'] }, labels: { state: 'available', choices: ['backend'] } });
  expect((await discoverVocabulary('org/project/repo', { ...available, azure: async () => ({ value: [] }) })).types).toEqual({ state: 'available', choices: [] });
});

for (const repo of ['org/repo', 'org/project/repo']) {
  test(`${repo} reports credential refusal separately from unsupported capabilities`, async () => {
    for (const [status, state] of [[403, 'refused'], [501, 'unsupported'], [404, 'refused']] as const) {
      const fail = async () => { throw new Error(`HTTP ${status}: ${status === 501 ? 'Not implemented' : 'Access denied'}`); };
      const result = await discoverVocabulary(repo, { github: fail, azure: fail });
      expect(result.types.state).toBe(state);
      expect(result.labels.state).toBe(state);
      expect(result.types).toHaveProperty('reason');
    }
  });
}

test('personal GitHub repositories have no issue types, without disguising a refused labels read', async () => {
  const paths: string[] = [];
  const result = await discoverVocabulary('person/repo', { ...available, github: async (path) => {
    paths.push(path);
    if (path.includes('/labels')) throw new Error('HTTP 403: Labels denied');
    return { owner: { type: 'User' } };
  } });
  expect(result.types.state).toBe('unsupported');
  expect(result.labels).toEqual({ state: 'refused', reason: 'HTTP 403: Labels denied' });
  expect(paths.some((p) => p.endsWith('issue-types'))).toBe(false);
});

test('the command reads the board settings while it is closed and detects mapping and destination changes', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeListFile, setVocabularyOverride, setOverride } = await import('./repository-settings.ts');
  const { readPublicationSettings } = await import('./publication-settings.ts');
  const dir = await mkdtemp(join(tmpdir(), 'publication settings '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const repo = 'org/project/repo';
  writeListFile(dir, { repositories: [{ repo }] });
  setVocabularyOverride(repo, 'build', { type: 'User Story', labels: ['backend'] }, dir);
  const first = await readPublicationSettings(repo, { dir, reads: available });
  expect(first.setup.vocabularySources.build).toBe('local');
  setVocabularyOverride(repo, 'build', { type: null, labels: [] }, dir);
  const local = await readPublicationSettings(repo, { dir, reads: available });
  expect(local.setup.vocabulary.build).toEqual({ type: null, labels: [] });
  expect(local.setup.vocabularySources.build).toBe('local');
  expect(local.snapshot).not.toBe(first.snapshot);
  setVocabularyOverride(repo, 'build', undefined, dir);
  expect((await readPublicationSettings(repo, { dir, reads: available })).setup.vocabulary.build.type).toBeNull();
  setOverride(repo, 'itemSource', { kind: 'azure-board', team: 'Platform' }, dir);
  expect((await readPublicationSettings(repo, { dir, reads: available })).snapshot).not.toBe(first.snapshot);
});

test('Azure excludes disabled work item types and reads the documented tags envelope', async () => {
  const found = await discoverVocabulary('org/project/repo', { ...available, azure: async (_repo, resource) => resource === 'workitemtypes'
    ? { value: [{ name: 'Bug', isDisabled: false }, { name: 'Retired', isDisabled: true }] }
    : [{ count: 1, value: [{ name: 'backend' }] }] });
  expect(found.types).toEqual({ state: 'available', choices: ['Bug'] });
  expect(found.labels).toEqual({ state: 'available', choices: ['backend'] });
});

test('Azure metadata uses the extension login and only a GET, including encoded project names', async () => {
  const { readAzureVocabulary } = await import('./publication-settings.ts');
  const found = await readAzureVocabulary('org/Team%20Project/repo', 'tags', async (args) => {
    expect(args.slice(0, 6)).toEqual(['devops', 'invoke', '--area', 'wit', '--resource', 'tags']);
    expect(args).toContain('project=Team Project');
    expect(args[args.indexOf('--http-method') + 1]).toBe('GET');
    expect(args[args.indexOf('--org') + 1]).toBe('https://dev.azure.com/org');
    return JSON.stringify({ value: [{ name: 'backend' }] });
  });
  expect(found).toEqual({ value: [{ name: 'backend' }] });
});

// Repository write defaults reject malformed values at the settings boundary.
test('issue defaults require boolean values', async () => {
  const { validateRepositorySettings } = await import('./repository-settings.ts');
  expect(validateRepositorySettings({ createIssuesFromAddItem: 'yes' }, false)).toBe('field createIssuesFromAddItem must be a boolean');
  expect(validateRepositorySettings({ createIssuesFromRetro: false, writeRefinedSpec: true }, false)).toBeNull();
});

test('legacy settings load default preferences and private domain docs as off', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeListFile, readRepositorySetups, setOverride, replaceAccess } = await import('./repository-settings.ts');
  const { effectiveIssueSettings } = await import('./write-access.ts');
  const dir = mkdtempSync(join(tmpdir(), 'issue-defaults-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeListFile(dir, { repositories: [{ repo: 'org/repo', settings: { overrides: { domainDocs: { kind: 'private' } } } }] });
  const read = () => readRepositorySetups(dir)[0]!;
  expect(read()).toMatchObject({ domainDocs: { kind: 'off' }, createIssuesFromAddItem: true, createIssuesFromRetro: true, writeRefinedSpec: true });
  expect(effectiveIssueSettings(read())).toMatchObject({ createIssuesFromAddItem: false, createIssuesFromRetro: false, writeRefinedSpec: false });
  replaceAccess('org/repo', { 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' }, dir);
  expect(effectiveIssueSettings(read())).toEqual({ createIssuesFromAddItem: true, createIssuesFromRetro: true, writeRefinedSpec: true, createReason: null, specReason: null });
  replaceAccess('org/repo', { 'publish-ticket': 'refused', 'edit-ticket': 'allowed' }, dir);
  expect(effectiveIssueSettings(read())).toMatchObject({ createIssuesFromRetro: false, writeRefinedSpec: true, createReason: 'Access to publish-ticket was refused. Recheck access in Settings.' });
  replaceAccess('org/repo', { 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' }, dir);
  setOverride('org/repo', 'createIssuesFromAddItem', false, dir);
  expect(effectiveIssueSettings(read()).createIssuesFromAddItem).toBe(false);
  expect(effectiveIssueSettings({ ...read(), repo: 'org/project/repo' }, { azureReadOnly: true })).toMatchObject({ createIssuesFromRetro: false, writeRefinedSpec: false, createReason: 'Azure DevOps is read-only in this test session.', specReason: 'Azure DevOps is read-only in this test session.' });
});
