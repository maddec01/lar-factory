import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { blockedBy, blockedPathNote } from './blocked-skill.ts';
import type { BlockingPath } from './install-skills.ts';

const agents: BlockingPath = { place: 'agents', path: '/home/.agents/skills/grill' };
const antigravity: BlockingPath = { place: 'antigravity', path: '/home/.gemini/config/skills/grill' };
const profile: BlockingPath = { place: 'profile', profile: '.claude-work', path: '/home/.claude-work/skills/grill' };

test('each place a blocking path can be says where it leaves the skill missing', () => {
  assert.equal(blockedPathNote(agents), "the skill isn't installed");
  assert.equal(blockedPathNote(antigravity), "the skill isn't installed for Antigravity");
  assert.equal(blockedPathNote(profile), "the skill isn't linked into ~/.claude-work; unticking the profile also clears it");
});

test('one blocking path is a path, with its note', () => {
  assert.equal(blockedBy([agents]).join(''), "blocked by a path Lar Factory didn't install: /home/.agents/skills/grill (the skill isn't installed)");
});

test('several blocking paths are paths, each with its note, in order', () => {
  assert.equal(blockedBy([antigravity, profile]).join(''),
    "blocked by paths Lar Factory didn't install: /home/.gemini/config/skills/grill (the skill isn't installed for Antigravity), " +
    "/home/.claude-work/skills/grill (the skill isn't linked into ~/.claude-work; unticking the profile also clears it)");
});

test('each path comes out as the render makes it, between the wording', () => {
  assert.deepEqual(blockedBy([agents, profile], (path) => ({ path })), [
    "blocked by paths Lar Factory didn't install: ", { path: agents.path }, " (the skill isn't installed)",
    ', ', { path: profile.path }, " (the skill isn't linked into ~/.claude-work; unticking the profile also clears it)",
  ]);
});
