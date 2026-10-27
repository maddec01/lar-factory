// The repository colour: a repository's place among the board's repositories, whatever case its owner/name is in.

import { expect, test } from 'vite-plus/test';
import { repoTone } from './item-parts.tsx';

test("a repository takes its board colour whatever the case of its owner/name, and one off the board the muted colour", () => {
  const repos = [{ repo: 'maddec01/lar-server', role: 'api', labels: [] }, { repo: 'Maddec01/lar-factory', role: 'factory', labels: [] }];
  expect(repoTone('maddec01/lar-factory', repos)).toBe('repo-tone-1');
  expect(repoTone('someone/elsewhere', repos)).toBe('repo-tone-none');
  expect(repoTone('Draft', repos)).toBe('repo-tone-none');
});
