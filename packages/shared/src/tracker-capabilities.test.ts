import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { customLabelProblem, customTagProblem } from './custom-labels.ts';
import { trackerCapabilities } from './tracker-capabilities.ts';

test('GitHub has labels with colour and description, scoped to the repository, and sync needs linked-work', () => {
  assert.deepEqual(trackerCapabilities('maddec01/lar-factory'), {
    noun: 'label', heading: 'Labels', color: true, description: true,
    deleteWarning: 'This removes it from every ticket.', changeScope: 'repository', syncLabel: 'linked-work', createUnavailable: null, nameProblem: customLabelProblem,
  });
});

test('Azure DevOps has tags with neither, scoped to the project, sync needs no tag and a tag has no create', () => {
  assert.deepEqual(trackerCapabilities('fabrikam/fiber/lar-factory'), {
    noun: 'tag', heading: 'Tags', color: false, description: false,
    deleteWarning: 'This removes it from every work item and pull request.', changeScope: 'project', syncLabel: null,
    createUnavailable: 'Azure DevOps has no way to create a tag on its own. A new tag appears when it is first added to a work item.',
    nameProblem: customTagProblem,
  });
});
