import { expect, test, vi } from 'vite-plus/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeListFile } from '@lar-factory/shared/repository-settings';
import { publicationVocabulary } from './vocabulary.ts';

test('the board reads fresh effective Vocabulary through the same Node interface and refuses unlisted repositories before provider access', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'board Vocabulary '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  writeListFile(dir, { repositories: [{ repo: 'org/repo' }] });
  const github = vi.fn(async (path: string) => path.includes('/labels') ? [] : path.includes('/issue-types') ? [{ name: 'Epic' }] : { owner: { type: 'Organization' } });
  const reads = { github, azure: vi.fn(), sharedConfig: vi.fn(async () => JSON.stringify({ vocabulary: { concept: { type: 'Epic', labels: [] } } })) };
  expect(await publicationVocabulary('org/other', dir, reads)).toEqual({ status: 409, error: "org/other is not on this Mac's list." });
  expect(github).not.toHaveBeenCalled();
  expect(reads.sharedConfig).not.toHaveBeenCalled();
  const result = await publicationVocabulary('org/repo', dir, reads);
  expect('setup' in result && result.setup.vocabulary.concept).toEqual({ type: 'Epic', labels: [] });
  expect('setup' in result && result.setup.vocabularySources.concept).toBe('shared');
  expect('discovery' in result && result.discovery.labels).toEqual({ state: 'available', choices: [] });
});
