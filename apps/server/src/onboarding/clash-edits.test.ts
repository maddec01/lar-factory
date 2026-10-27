import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Clash } from '@lar-factory/shared';
import { isInstructionFile, isLineEdit, opencodeInstructions, overlaps } from './clash-edits.ts';

const edit = (line: number, remove: number, file = 'AGENTS.md') => {
  const clash: Clash = { id: `${file}:${line}`, file, line, reason: 'It clashes.', ticked: true,
    edit: { kind: 'lines', remove: Array.from({ length: remove }, (_, i) => `line ${line + i}`), add: [] } };
  assert.ok(isLineEdit(clash));
  return clash;
};

test('two edits overlap when their removed lines meet, or one inserts at or inside the other; never across files', () => {
  assert.equal(overlaps(edit(3, 2), edit(4, 1)), true);
  assert.equal(overlaps(edit(3, 2), edit(5, 1)), false);
  assert.equal(overlaps(edit(3, 2), edit(4, 0)), true);
  assert.equal(overlaps(edit(3, 0), edit(3, 1)), true);
  assert.equal(overlaps(edit(5, 0), edit(3, 2)), false);
  assert.equal(overlaps(edit(3, 1), edit(3, 1, 'CLAUDE.md')), false);
});

test("instruction files are the ones the agent is told to read, with opencode.json's named paths and globs", () => {
  const named = opencodeInstructions('{ "instructions": ["./docs/rules.md", "guides/**/*.md", 7] }');
  assert.deepEqual(named, ['docs/rules.md', 'guides/**/*.md']);
  for (const path of ['AGENTS.md', 'web/CLAUDE.local.md', '.agents/rules/x.md', 'docs/rules.md', 'guides/a/b.md']) assert.ok(isInstructionFile(path, named), path);
  for (const path of ['.github/workflows/ci.yml', 'docs/other.md', 'a/../AGENTS.md', '']) assert.ok(!isInstructionFile(path, named), path);
  assert.deepEqual(opencodeInstructions('not json'), []);
});

test('opencode.json names only Markdown files outside .github/, so "**" lets no edit reach a workflow', () => {
  const named = opencodeInstructions('{ "instructions": ["**", "rules.txt", ".github/*.md"] }');
  for (const path of ['docs/any.md', 'README.md']) assert.ok(isInstructionFile(path, named), path);
  for (const path of ['.github/workflows/ci.yml', '.github/copilot-instructions.md', 'package.json', 'rules.txt']) assert.ok(!isInstructionFile(path, named), path);
});
