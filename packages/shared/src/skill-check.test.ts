import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { isSkillCheckRequest } from './skill-check.ts';

test("a request carries the User's Drift choice, and nothing else", () => {
    assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1 }), true);
    assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1, drift: 'replace' }), true);
    assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1, drift: 'keep' }), true);
    assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1, drift: 'overwrite' }), false);
});
