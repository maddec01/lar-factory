import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { projectSkills } from './project-skills.ts';

test("each agent's project skill folder is scanned for folders holding a SKILL.md, and nothing else", () => {
  const dirs = ['.claude', '.agents', '.cursor', '.codex', '.opencode', '.grok', '.pi'];
  assert.deepEqual(projectSkills([
    ...dirs.map((dir, i) => `${dir}/skills/own-${i}/SKILL.md`),
    '.claude/skills/code-review/notes.md', '.claude/skills/no-skill-file/notes.md', '.windsurf/skills/tdd/SKILL.md',
    'apps/web/.claude/skills/tdd/SKILL.md', '.claude/skills/nested/deeper/SKILL.md',
  ]), dirs.map((dir, i) => ({ name: `own-${i}`, path: `${dir}/skills/own-${i}/` })));
});
