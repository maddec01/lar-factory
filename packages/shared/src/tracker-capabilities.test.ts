import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { trackerCapabilities } from './tracker-capabilities.ts';

test('GitHub has labels with colour and description, scoped to the repository, and sync needs linked-work', () => {
  assert.deepEqual(trackerCapabilities('maddec01/lar-factory'), {
    noun: 'label', heading: 'Labels', color: true, description: true,
    deleteWarning: 'This removes it from every ticket.', changeScope: 'repository', syncLabel: 'linked-work',
  });
});

test('Azure DevOps has tags with neither, scoped to the project, and sync needs no tag', () => {
  assert.deepEqual(trackerCapabilities('fabrikam/fiber/lar-factory'), {
    noun: 'tag', heading: 'Tags', color: false, description: false,
    deleteWarning: 'This removes it from every work item and pull request.', changeScope: 'project', syncLabel: null,
  });
});
