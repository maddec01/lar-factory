import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isSkillCheckAnswer, isSkillCheckRequest } from './skill-check.ts';

test('a request carries the User\'s Drift choice, and nothing else', () => {
  assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1 }), true);
  assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1, drift: 'replace' }), true);
  assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1, drift: 'keep' }), true);
  assert.equal(isSkillCheckRequest({ type: 'check-skills', id: 1, drift: 'overwrite' }), false);
});

test('an answer names the skills with Drift as strings', () => {
  assert.equal(isSkillCheckAnswer({ type: 'skills-checked', id: 1, refusal: null }), true);
  assert.equal(isSkillCheckAnswer({ type: 'skills-checked', id: 1, refusal: 'Replace or start anyway', drift: ['lar-build'] }), true);
  assert.equal(isSkillCheckAnswer({ type: 'skills-checked', id: 1, refusal: 'x', drift: [1] }), false);
  assert.equal(isSkillCheckAnswer({ type: 'skills-checked', id: 1, refusal: 'x', drift: 'lar-build' }), false);
});
