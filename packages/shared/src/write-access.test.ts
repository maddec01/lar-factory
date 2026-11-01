import { expect, test } from 'vite-plus/test';
import { writeAccessProblem } from './write-access.ts';

test('writes require verified access and respect Azure safety', () => {
  expect(writeAccessProblem('org/repo', 'publish-ticket', {})).toContain('not checked');
  expect(writeAccessProblem('org/repo', 'publish-ticket', { 'publish-ticket': 'refused' })).toContain('refused');
  expect(writeAccessProblem('org/repo', 'publish-ticket', { 'publish-ticket': 'allowed' })).toBeNull();
  expect(writeAccessProblem('org/project/repo', 'publish-ticket', { 'publish-ticket': 'allowed' }, { azureReadOnly: true })).toContain('read-only');
  expect(writeAccessProblem('VanEckEurope/VanEckDirect%20IApp/repo', 'publish-ticket', { 'publish-ticket': 'allowed' })).toContain('never');
});

test('legacy consent loads without granting access and disappears on resave', async (t) => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeListFile, readRepositorySetups, setStructureSync } = await import('./repository-settings.ts');
  const { REPOSITORY_LIST_FILE } = await import('./data-dir.ts');
  const dir = mkdtempSync(join(tmpdir(), 'legacy-access-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeListFile(dir, { repositories: [{ repo: 'org/repo', settings: { consent: ['publish-ticket'] } }] });
  expect(readRepositorySetups(dir)[0]).not.toHaveProperty('consent');
  setStructureSync('org/repo', true, dir);
  expect(readFileSync(join(dir, REPOSITORY_LIST_FILE), 'utf8')).not.toContain('consent');
});

test('unverified GitHub access explains supported credentials and editing restrictions', () => {
  expect(writeAccessProblem('org/repo', 'publish-ticket', {})).toContain('classic token or gh OAuth');
  expect(writeAccessProblem('org/repo', 'edit-ticket', {})).toContain("cannot edit other people's issues");
  expect(writeAccessProblem('org/repo', 'edit-ticket', { 'edit-ticket': 'allowed' })).toBeNull();
});
