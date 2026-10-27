import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Clash, OnboardingPicks } from '@lar-factory/shared';
import type { CommitTree, TreeEntry } from '../github/github.ts';
import { AGENT_SKILLS_BLOCK } from './agent-setup.ts';
import { planPrChanges } from './pr-changes.ts';

const CONFIG = '{ "version": 1 }\n';
const BUNDLED = ['code-review', 'tdd', 'to-tickets'];
const DOCS = ['docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md'];

/** A default branch with `files`, each at a blob named after its path, and the reader of those blobs. */
function branch(files: Record<string, string>, links: string[] = []) {
  const mode = (path: string) => links.includes(path) ? '120000' : path.endsWith('bin/run') ? '100755' : '100644';
  const tree: CommitTree = { sha: 'tree0', files: new Map(Object.keys(files).map((path) => [path, { mode: mode(path), sha: `blob:${path}` }])) };
  const read = async (sha: string) => files[sha.slice('blob:'.length)]!;
  return { tree, read };
}

const plan = (files: Record<string, string>, picks: Partial<OnboardingPicks> = {}, config: string | null = CONFIG, links: string[] = []) => {
  const { tree, read } = branch(files, links);
  return planPrChanges(tree, read, config, { clashes: [], skills: {}, ...picks }, BUNDLED);
};

const byPath = (entries: TreeEntry[]) => new Map(entries.map(({ path, ...rest }) => [path, rest]));

const pushRule: Clash = { id: 'push', file: 'AGENTS.md', line: 3, ticked: true, reason: 'It pushes to main, and the factory opens PRs.',
  edit: { kind: 'lines', remove: ['- Push to main when done.'], add: ['- Open a PR when done.'] } };

test('a repository with nothing to clean gets the Agent skills block, the docs/agents/ files and its .lar-factory.json', async () => {
  const planned = await plan({ 'README.md': '# lar-web\n' });
  assert.ok(!('problem' in planned));
  assert.deepEqual(planned.changes, [{ kind: 'agent-skills', path: 'AGENTS.md' },
    ...DOCS.map((path) => ({ kind: 'write', path, created: true })), { kind: 'write', path: '.lar-factory.json', created: true }]);
  const entries = byPath(planned.entries);
  assert.deepEqual(entries.get('AGENTS.md'), { mode: '100644', content: AGENT_SKILLS_BLOCK });
  assert.deepEqual(entries.get('.lar-factory.json'), { mode: '100644', content: CONFIG });
  assert.deepEqual([...entries.keys()].sort(), ['.lar-factory.json', 'AGENTS.md', ...DOCS].sort());
});

test('a reused .lar-factory.json is left alone, and docs/agents/ files already there are replaced', async () => {
  const planned = await plan({ '.lar-factory.json': CONFIG, 'CLAUDE.md': '# lar-web\n', 'docs/agents/domain.md': 'Old.\n' }, {}, null);
  assert.ok(!('problem' in planned));
  assert.deepEqual(planned.changes.slice(0, 1), [{ kind: 'agent-skills', path: 'CLAUDE.md' }]);
  assert.deepEqual(planned.changes.find((change) => change.path === 'docs/agents/domain.md'), { kind: 'write', path: 'docs/agents/domain.md', created: false });
  assert.ok(!planned.changes.some((change) => change.path === '.lar-factory.json'));
  assert.ok(!planned.entries.some((entry) => entry.path === '.lar-factory.json'));
});

test('a CLAUDE.md that links to AGENTS.md gets the Agent skills block written in AGENTS.md, leaving the link as it is', async () => {
  const planned = await plan({ 'CLAUDE.md': 'AGENTS.md', 'AGENTS.md': '# lar-web\n' }, {}, CONFIG, ['CLAUDE.md']);
  assert.ok(!('problem' in planned));
  const entries = byPath(planned.entries);
  assert.equal(entries.get('CLAUDE.md'), undefined);
  assert.deepEqual(entries.get('AGENTS.md'), { mode: '100644', content: `# lar-web\n\n${AGENT_SKILLS_BLOCK}` });
  assert.deepEqual(planned.changes.filter((change) => change.kind === 'agent-skills'), [{ kind: 'agent-skills', path: 'AGENTS.md' }]);

  const block = `# lar-web\n\n${AGENT_SKILLS_BLOCK}`;
  const nested = await plan({ 'CLAUDE.md': 'docs/AGENTS.md', 'docs/AGENTS.md': block.replace('GitHub issues', 'Linear') }, {}, CONFIG, ['CLAUDE.md']);
  assert.ok(!('problem' in nested));
  assert.deepEqual(byPath(nested.entries).get('docs/AGENTS.md'), { mode: '100644', content: block });
  assert.deepEqual(await plan({ 'CLAUDE.md': '../AGENTS.md' }, {}, CONFIG, ['CLAUDE.md']),
    { problem: "CLAUDE.md links to a file that isn't on the default branch, so the Agent skills block has nowhere to go." });
});

test('a CLAUDE.md or AGENTS.md that links to a file no agent reads as instructions is refused, so the block never lands there', async () => {
  const workflow = '.github/workflows/ci.yml';
  assert.deepEqual(await plan({ 'AGENTS.md': workflow, [workflow]: 'on: push\n' }, {}, CONFIG, ['AGENTS.md']), { problem: 'AGENTS.md links to '
    + ".github/workflows/ci.yml, which is no instruction file, so the Agent skills block can't go there. Make it a file, or a link to an instruction file, on the default branch, then come back." });
  assert.match((await plan({ 'CLAUDE.md': 'notes.txt', 'notes.txt': 'lar-web\n' }, {}, CONFIG, ['CLAUDE.md']) as { problem: string }).problem, /CLAUDE\.md links to notes\.txt/);
  assert.match((await plan({ 'CLAUDE.md': '.github/notes.md', '.github/notes.md': '# lar-web\n' }, {}, CONFIG, ['CLAUDE.md']) as { problem: string }).problem,
    /CLAUDE\.md links to \.github\/notes\.md/);
});

test('a CLAUDE.md that links to any Markdown file outside .github/ gets the block there', async () => {
  for (const target of ['docs/ai-guidelines.md', 'README.md']) {
    const planned = await plan({ 'CLAUDE.md': target, [target]: '# lar-web\n' }, {}, CONFIG, ['CLAUDE.md']);
    assert.ok(!('problem' in planned), target);
    assert.deepEqual(byPath(planned.entries).get(target), { mode: '100644', content: `# lar-web\n\n${AGENT_SKILLS_BLOCK}` });
  }
});

test('a ticked edit swaps its lines at its line, before the Agent skills block goes in the same file', async () => {
  const agents = '# lar-web\n\n- Push to main when done.\n- Run the tests.\n';
  const planned = await plan({ 'AGENTS.md': agents }, { clashes: [pushRule] });
  assert.ok(!('problem' in planned));
  assert.equal((byPath(planned.entries).get('AGENTS.md') as { content: string }).content,
    `# lar-web\n\n- Open a PR when done.\n- Run the tests.\n\n${AGENT_SKILLS_BLOCK}`);
  assert.deepEqual(planned.changes.find((change) => change.kind === 'edit'), { kind: 'edit', path: 'AGENTS.md', line: 3, reason: pushRule.reason });
});

test('two edits in one file each apply at the line they name on the default branch', async () => {
  const later: Clash = { ...pushRule, id: 'tracker', line: 5, edit: { kind: 'lines', remove: ['- Track work in Linear.'], add: [] } };
  const insert: Clash = { ...pushRule, id: 'insert', line: 1, edit: { kind: 'lines', remove: [], add: ['<!-- onboarded -->', ''] } };
  const planned = await plan({ 'CLAUDE.md': '# x\n\n- Push to main when done.\n\n- Track work in Linear.\n', 'AGENTS.md': '# x\n' },
    { clashes: [{ ...pushRule, file: 'CLAUDE.md' }, { ...later, file: 'CLAUDE.md' }, { ...insert, file: 'CLAUDE.md' }] });
  assert.ok(!('problem' in planned));
  assert.equal((byPath(planned.entries).get('CLAUDE.md') as { content: string }).content,
    `<!-- onboarded -->\n\n# x\n\n- Open a PR when done.\n\n${AGENT_SKILLS_BLOCK}`);
});

test("an edit whose removed lines no longer match its line fails with the file and line, and plans nothing", async () => {
  assert.deepEqual(await plan({ 'AGENTS.md': '# lar-web\n\n- Push to main once reviewed.\n' }, { clashes: [pushRule] }),
    { problem: "AGENTS.md line 3 doesn't have the lines its edit removes. Untick it on Cleanup, or Look again there." });
  assert.deepEqual(await plan({ 'AGENTS.md': '# lar-web\n' }, { clashes: [pushRule] }),
    { problem: "AGENTS.md line 3 doesn't have the lines its edit removes. Untick it on Cleanup, or Look again there." });
  assert.deepEqual(await plan({ 'README.md': '' }, { clashes: [pushRule] }),
    { problem: 'AGENTS.md is not on the default branch any more. Untick it on Cleanup, or Look again there.' });
});

test("an edit of a file the Clash agent doesn't read, or one that touches another edit's lines, is refused", async () => {
  const workflow: Clash = { ...pushRule, file: '.github/workflows/ci.yml', line: 1, edit: { kind: 'lines', remove: ['on: push'], add: ['on: pull_request_target'] } };
  assert.deepEqual(await plan({ '.github/workflows/ci.yml': 'on: push\n' }, { clashes: [workflow] }),
    { problem: ".github/workflows/ci.yml is no instruction file the Clash agent reads, so the PR won't edit it." });
  const named = await plan({ 'opencode.json': '{ "instructions": ["docs/rules.md"] }', 'docs/rules.md': 'on: push\n' },
    { clashes: [{ ...workflow, file: 'docs/rules.md' }] });
  assert.ok(!('problem' in named));
  const agents = '# lar-web\n\n- Push to main when done.\n- Run the tests.\n';
  const wider: Clash = { ...pushRule, id: 'wider', edit: { kind: 'lines', remove: ['- Push to main when done.', '- Run the tests.'], add: [] } };
  assert.deepEqual(await plan({ 'AGENTS.md': agents }, { clashes: [pushRule, wider] }),
    { problem: "AGENTS.md line 3's edit touches the lines of another edit in the file. Untick it on Cleanup, or Look again there." });
});

test("CONTEXT.md's rename moves its blob, and .scratch/'s delete removes each file in it", async () => {
  const planned = await plan({ 'CONTEXT.md': '# Glossary\n', '.scratch/a.md': 'a', '.scratch/b/c.md': 'c', 'AGENTS.md': '' }, { clashes: [
    { id: 'context', file: 'CONTEXT.md', ticked: true, reason: 'Old name.', edit: { kind: 'rename', to: 'GLOSSARY.md' } },
    { id: 'scratch', file: '.scratch/', ticked: true, reason: 'Local tracker.', edit: { kind: 'delete' } },
  ] });
  assert.ok(!('problem' in planned));
  const entries = byPath(planned.entries);
  assert.deepEqual(entries.get('GLOSSARY.md'), { mode: '100644', sha: 'blob:CONTEXT.md' });
  for (const path of ['CONTEXT.md', '.scratch/a.md', '.scratch/b/c.md']) assert.deepEqual(entries.get(path), { mode: '100644', sha: null });
  assert.deepEqual(planned.changes.slice(-2), [{ kind: 'rename', path: 'CONTEXT.md', to: 'GLOSSARY.md' }, { kind: 'delete', path: '.scratch/' }]);
});

test("a skill renamed moves its folder, keeping each file's mode, and its SKILL.md's name follows", async () => {
  const skill = '---\nname: code-review\ndescription: Our review.\n---\n\n# Review\nname: stays in the body.\n';
  const planned = await plan({ '.claude/skills/code-review/SKILL.md': skill, '.claude/skills/code-review/bin/run': '#!/bin/sh\n' },
    { skills: { '.claude/skills/code-review/': { kind: 'rename', name: 'web-review' } } });
  assert.ok(!('problem' in planned));
  const entries = byPath(planned.entries);
  assert.deepEqual(entries.get('.claude/skills/web-review/SKILL.md'), { mode: '100644', content: skill.replace('name: code-review', 'name: web-review') });
  assert.deepEqual(entries.get('.claude/skills/web-review/bin/run'), { mode: '100755', sha: 'blob:.claude/skills/code-review/bin/run' });
  assert.deepEqual(entries.get('.claude/skills/code-review/SKILL.md'), { mode: '100644', sha: null });
  assert.deepEqual(entries.get('.claude/skills/code-review/bin/run'), { mode: '100755', sha: null });
  assert.deepEqual(planned.changes.at(-1), { kind: 'rename', path: '.claude/skills/code-review/', to: '.claude/skills/web-review/' });
});

test("a renamed skill's SKILL.md with \\r\\n lines gets its name: set too", async () => {
  const skill = '---\r\nname: code-review\r\ndescription: Our review.\r\n---\r\n\r\n# Review\r\n';
  const planned = await plan({ '.claude/skills/code-review/SKILL.md': skill }, { skills: { '.claude/skills/code-review/': { kind: 'rename', name: 'web-review' } } });
  assert.ok(!('problem' in planned));
  assert.deepEqual(byPath(planned.entries).get('.claude/skills/web-review/SKILL.md'),
    { mode: '100644', content: skill.replace('name: code-review', 'name: web-review') });
});

test('a skill deleted removes its folder; a pick for a path the branch lacks, or a rename onto a file it has, fails', async () => {
  const files = { '.agents/skills/tdd/SKILL.md': '---\nname: tdd\n---\n', '.agents/skills/ours/SKILL.md': '---\nname: ours\n---\n' };
  const deleted = await plan(files, { skills: { '.agents/skills/tdd/': { kind: 'delete' } } });
  assert.ok(!('problem' in deleted));
  assert.deepEqual(byPath(deleted.entries).get('.agents/skills/tdd/SKILL.md'), { mode: '100644', sha: null });
  assert.deepEqual(deleted.changes.at(-1), { kind: 'delete', path: '.agents/skills/tdd/' });
  assert.deepEqual(await plan(files, { skills: { '.pi/skills/tdd/': { kind: 'delete' } } }),
    { problem: '.pi/skills/tdd/ is no project skill named like a bundled skill on the default branch. Go Back to Cleanup, which checks the default branch again.' });
  assert.deepEqual(await plan(files, { skills: { '.agents/skills/ours/': { kind: 'delete' } } }),
    { problem: '.agents/skills/ours/ is no project skill named like a bundled skill on the default branch. Go Back to Cleanup, which checks the default branch again.' });
  assert.deepEqual(await plan(files, { skills: { '.agents/skills/tdd/': { kind: 'rename', name: 'ours' } } }),
    { problem: "Can't rename .agents/skills/tdd/: Another project skill is named ours." });
  assert.deepEqual(await plan(files, { skills: { '.agents/skills/tdd/': { kind: 'rename', name: 'code-review' } } }),
    { problem: "Can't rename .agents/skills/tdd/: code-review is a bundled skill’s name too." });
  for (const path of ['.agents/skills/../', '.agents/skills/./', 'skills/tdd/', '.github/workflows/']) {
    assert.match((await plan(files, { skills: { [path]: { kind: 'delete' } } }) as { problem: string }).problem, /is no project skill/, path);
  }
  assert.deepEqual(await plan({ ...files, '.agents/skills/tdd/README.md': 'x', '.agents/skills/web-tdd/README.md': 'x' }, { skills: { '.agents/skills/tdd/': { kind: 'rename', name: 'web-tdd' } } }),
    { problem: "Can't rename .agents/skills/tdd/ to .agents/skills/web-tdd/, since the default branch has .agents/skills/web-tdd/README.md." });
});

test('two skills in one skills folder renamed to the same name fail, rather than both moving into one folder', async () => {
  const files = { '.agents/skills/tdd/SKILL.md': '---\nname: tdd\n---\n', '.agents/skills/code-review/SKILL.md': '---\nname: code-review\n---\n',
    '.claude/skills/tdd/SKILL.md': '---\nname: tdd\n---\n' };
  const rename = { kind: 'rename', name: 'web-skill' } as const;
  assert.deepEqual(await plan(files, { skills: { '.agents/skills/tdd/': rename, '.agents/skills/code-review/': rename } }),
    { problem: "Can't rename .agents/skills/tdd/: Another skill in its folder is renamed web-skill too." });
  assert.ok(!('problem' in await plan(files, { skills: { '.agents/skills/tdd/': rename, '.claude/skills/tdd/': rename } })));
});
