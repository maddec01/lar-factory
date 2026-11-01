import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { customLabelProblem, customTagProblem } from './custom-labels.ts';
import { kindMappingOffers, labelsOnRow, trackerCapabilities, typedLabelsProblem } from './tracker-capabilities.ts';

test('GitHub has labels with colour and description, scoped to the repository, and sync needs linked-work', () => {
  const { sharesLabels, isManaged: _isManaged, ticketNameProblem: _ticketNameProblem, ...capabilities } = trackerCapabilities('maddec01/lar-factory');
  assert.deepEqual(capabilities, {
    noun: 'label', heading: 'Labels', color: true, description: true,
    deleteWarning: 'This removes it from every ticket.', changeScope: 'repository', syncLabel: 'linked-work', createUnavailable: null, nameProblem: customLabelProblem,
  });
  assert.equal(sharesLabels('maddec01/lar-factory', 'MADDEC01/Lar-Factory'), true);
  assert.equal(sharesLabels('maddec01/lar-factory', 'maddec01/other'), false);
});

test('Azure DevOps has tags with neither, scoped to the project, sync needs no tag and a tag has no create', () => {
  const { sharesLabels, isManaged: _isManaged, ticketNameProblem: _ticketNameProblem, ...capabilities } = trackerCapabilities('fabrikam/fiber/lar-factory');
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

const AZURE = 'fabrikam/fiber/one';
const GITHUB = 'maddec01/lar-factory';

test('a repo- tag is managed on Azure DevOps, in any case, and an ordinary label on GitHub', () => {
  for (const name of ['repo-one', 'REPO-One']) {
    assert.equal(trackerCapabilities(AZURE).isManaged(name), true, name);
    assert.match(trackerCapabilities(AZURE).nameProblem(name)!, /reserved for the work item's repository/);
    assert.equal(trackerCapabilities(GITHUB).isManaged(name), false, name);
    assert.equal(trackerCapabilities(GITHUB).nameProblem(name), null, name);
  }
  assert.equal(trackerCapabilities(GITHUB).isManaged('linked-work'), true);
  assert.equal(trackerCapabilities(AZURE).isManaged('linked-work'), true);
  assert.equal(trackerCapabilities(AZURE).isManaged('repository'), false);
});

test('rows hide a repo- tag on Azure DevOps and show a repo- label on GitHub', () => {
  const labels = ['repo-one', 'docs'];
  assert.deepEqual(labelsOnRow({ kind: 'issue', labels, repo: AZURE }, []), ['docs']);
  assert.deepEqual(labelsOnRow({ kind: 'issue', labels, repo: GITHUB }, []), ['repo-one', 'docs']);
});

test('a kind mapping offers ordinary labels and kind names, and no other managed label', () => {
  for (const name of ['docs', 'bug', 'User Story']) assert.equal(kindMappingOffers(GITHUB, name), true, name);
  for (const name of ['linked-work', 'LINKED-WORK', 'status-queued', 'decision-grill']) assert.equal(kindMappingOffers(GITHUB, name), false, name);
  assert.equal(kindMappingOffers(GITHUB, 'repo-one'), true);
  assert.equal(kindMappingOffers(AZURE, 'repo-one'), false);
});

test('a ticket takes a name holding a separator on GitHub, and refuses it on Azure DevOps', () => {
  for (const name of ['foo; linked-work', 'foo, bar']) {
    assert.equal(trackerCapabilities(GITHUB).ticketNameProblem(name), null, name);
    assert.equal(trackerCapabilities(AZURE).ticketNameProblem(name), 'Use a tag name without commas or semicolons.', name);
  }
});

test('a typed name in Add item cannot carry a managed tag past its separator on Azure DevOps', () => {
  assert.equal(typedLabelsProblem(AZURE, ['foo; linked-work']), 'Use a tag name without commas or semicolons.');
  assert.equal(typedLabelsProblem(AZURE, ['foo, repo-other']), 'Use a tag name without commas or semicolons.');
});
