import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { customLabelProblem, customTagProblem } from './custom-labels.ts';
import { trackerCapabilities, typedLabelsProblem } from './tracker-capabilities.ts';

test('GitHub has labels with colour and description, scoped to the repository, and sync needs linked-work', () => {
  const { sharesLabels, ...capabilities } = trackerCapabilities('maddec01/lar-factory');
  assert.deepEqual(capabilities, {
    noun: 'label', heading: 'Labels', color: true, description: true,
    deleteWarning: 'This removes it from every ticket.', changeScope: 'repository', syncLabel: 'linked-work', createUnavailable: null, nameProblem: customLabelProblem,
  });
  assert.equal(sharesLabels('maddec01/lar-factory', 'MADDEC01/Lar-Factory'), true);
  assert.equal(sharesLabels('maddec01/lar-factory', 'maddec01/other'), false);
});

test('Azure DevOps has tags with neither, scoped to the project, sync needs no tag and a tag has no create', () => {
  const { sharesLabels, ...capabilities } = trackerCapabilities('fabrikam/fiber/lar-factory');
  assert.deepEqual(capabilities, {
    noun: 'tag', heading: 'Tags', color: false, description: false,
    deleteWarning: 'This removes it from every work item and pull request.', changeScope: 'project', syncLabel: null,
    createUnavailable: 'Azure DevOps has no way to create a tag on its own. A new tag appears when it is first added to a work item.',
    nameProblem: customTagProblem,
  });
  assert.equal(sharesLabels('fabrikam/my%20fiber/one', 'Fabrikam/My%20Fiber/two'), true);
  assert.equal(sharesLabels('fabrikam/fiber/one', 'fabrikam/other/one'), false);
  assert.equal(sharesLabels('fabrikam/fiber/one', 'other/fiber/one'), false);
  assert.equal(sharesLabels('fabrikam/fiber/one', 'fabrikam/fiber'), false);
});

test('a typed name is refused for its first problem, and a blank field names nothing', () => {
  assert.equal(typedLabelsProblem('maddec01/lar-factory', ['', '  ', 'triage']), null);
  assert.equal(typedLabelsProblem('maddec01/lar-factory', ['triage', 'linked-work']), "linked-work is reserved for the factory's saved links.");
  assert.equal(typedLabelsProblem('fabrikam/fiber/one', ['a;b']), 'Use a tag name without commas or semicolons.');
});
