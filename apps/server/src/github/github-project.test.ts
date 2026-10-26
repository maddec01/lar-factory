import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item } from '@lar-factory/shared';
import { DONE_REFUSED } from '../items/item-source.ts';
import { githubProject } from './github-project.ts';

test('a Done write is refused before it reaches GitHub', async () => {
  const project = githubProject({ owner: 'maddec01', number: 1 });
  const item = { id: 'I_7', status: 'Verify', statuses: ['Verify'] } as Item;
  assert.equal(await project.setStatus(item, 'Done'), DONE_REFUSED);
  assert.equal(await project.setParentStatus({ number: 5, title: 'Parent', url: '', repo: 'maddec01/lar', state: 'open' }, 'Done'), DONE_REFUSED);
});
