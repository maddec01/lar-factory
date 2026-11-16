import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { trackerCapabilities, typedLabelsProblem } from './tracker-capabilities.ts';

const AZURE = 'fabrikam/fiber/one';
const GITHUB = 'maddec01/lar-factory';

test('a repo- tag is managed on Azure DevOps, in any case, and an ordinary label on GitHub', () => {
    for (const name of ['repo-one', 'REPO-One']) {
        assert.equal(trackerCapabilities(AZURE).isManaged(name), true, name);
        assert.match(trackerCapabilities(AZURE).nameProblem(name)!, /reserved for the work item’s repository/);
        assert.equal(trackerCapabilities(GITHUB).isManaged(name), false, name);
        assert.equal(trackerCapabilities(GITHUB).nameProblem(name), null, name);
    }
    assert.equal(trackerCapabilities(GITHUB).isManaged('linked-work'), true);
    assert.equal(trackerCapabilities(AZURE).isManaged('linked-work'), true);
    assert.equal(trackerCapabilities(AZURE).isManaged('repository'), false);
});

test('a typed name in Add item can’t carry a managed tag past its separator on Azure DevOps', () => {
    assert.equal(typedLabelsProblem(AZURE, ['foo; linked-work']), 'Use a tag name without commas or semicolons.');
    assert.equal(typedLabelsProblem(AZURE, ['foo, repo-other']), 'Use a tag name without commas or semicolons.');
});
