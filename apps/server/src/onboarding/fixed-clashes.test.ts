import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { fakeAzRepos } from '../azure/fake-az.ts';
import { findFixedClashes } from './fixed-clashes.ts';

const BUNDLED = ['code-review', 'lar-work', 'tdd'];

/** A gh stub whose default branch `main` is at `abc123` and holds `files`; `fail` throws for the call it matches. */
function ghWith(files: string[], { truncated = false, fail }: { truncated?: boolean; fail?: RegExp } = {}) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (fail?.test(args.join(' '))) throw new Error('gh api failed: HTTP 502: Bad Gateway');
    if (args.includes('.default_branch')) return 'main\n';
    if (args[1] === 'repos/maddec01/lar-web/git/ref/heads/main') return 'abc123\n';
    if (args[1] === 'repos/maddec01/lar-web/git/trees/abc123?recursive=1') {
      return JSON.stringify({ truncated, tree: [...files.map((path) => ({ path, type: 'blob' })), { path: 'docs', type: 'tree' }] });
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { run, calls };
}

const find = (files: string[], options?: Parameters<typeof ghWith>[1]) =>
  findFixedClashes({ repo: 'maddec01/lar-web' }, ghWith(files, options).run, () => BUNDLED);

test('reads the default branch at its head through gh, without a checkout', async () => {
  const gh = ghWith(['AGENTS.md']);
  assert.deepEqual(await findFixedClashes({ repo: 'maddec01/lar-web' }, gh.run, () => BUNDLED), { clashes: [], skillClashes: [], projectSkills: [] });
  assert.deepEqual(gh.calls.map((args) => args[1]),
    ['repos/maddec01/lar-web', 'repos/maddec01/lar-web/git/ref/heads/main', 'repos/maddec01/lar-web/git/trees/abc123?recursive=1']);
});

test('CONTEXT.md gets a ticked offer to rename it to GLOSSARY.md', async () => {
  assert.deepEqual((await find(['CONTEXT.md', 'README.md']) as { clashes: unknown }).clashes, [{
    id: 'context', file: 'CONTEXT.md', ticked: true, edit: { kind: 'rename', to: 'GLOSSARY.md' },
    reason: "The factory's domain docs read GLOSSARY.md, and CONTEXT.md is its old name.",
  }]);
});

test('CONTEXT.md beside a GLOSSARY.md gets an unticked offer to delete it, since a rename would overwrite the glossary', async () => {
  assert.deepEqual((await find(['CONTEXT.md', 'GLOSSARY.md']) as { clashes: unknown }).clashes, [{
    id: 'context', file: 'CONTEXT.md', ticked: false, edit: { kind: 'delete' },
    reason: "The factory's domain docs read GLOSSARY.md, which the repository has, so nothing reads CONTEXT.md.",
  }]);
});

test('a multi-context layout with GLOSSARY-MAP.md and no GLOSSARY.md gets no Clash for its domain docs', async () => {
  assert.deepEqual(await find(['GLOSSARY-MAP.md', 'apps/web/GLOSSARY.md', 'docs/adr/0001-x.md']), { clashes: [], skillClashes: [], projectSkills: [] });
});

test('.scratch/ gets an unticked offer to delete it, with its file count', async () => {
  assert.deepEqual((await find(['.scratch/a/1.md', '.scratch/a/2.md', '.scratch/b.md', '.scratchpad.md']) as { clashes: unknown }).clashes, [{
    id: 'scratch', file: '.scratch/', ticked: false, edit: { kind: 'delete' },
    reason: ".scratch/ holds 3 files from Matt Pocock's local tracker. The factory tracks work on GitHub, so delete it once its tickets are moved.",
  }]);
  assert.match((await find(['.scratch/one.md']) as { clashes: { reason: string }[] }).clashes[0]!.reason, /holds 1 file from/);
});

test("each agent's project skill folder is scanned, and a skill named like a bundled one is a skill Clash", async () => {
  const dirs = ['.claude', '.agents', '.cursor', '.codex', '.opencode', '.grok', '.pi'];
  const found = await find([
    ...dirs.map((dir, i) => `${dir}/skills/own-${i}/SKILL.md`),
    '.claude/skills/code-review/SKILL.md', '.claude/skills/code-review/notes.md', '.pi/skills/TDD/SKILL.md',
    '.agents/skills/code-review/SKILL.md', '.claude/skills/no-skill-file/notes.md', '.windsurf/skills/tdd/SKILL.md',
    'apps/web/.claude/skills/tdd/SKILL.md',
  ]);
  assert.deepEqual(found, {
    clashes: [],
    skillClashes: [
      { name: 'code-review', path: '.agents/skills/code-review/' },
      { name: 'code-review', path: '.claude/skills/code-review/' },
      { name: 'TDD', path: '.pi/skills/TDD/' },
    ],
    projectSkills: ['TDD', 'code-review', 'own-0', 'own-1', 'own-2', 'own-3', 'own-4', 'own-5', 'own-6'],
  });
});

test("a gh failure returns gh's problem, not an empty list", async () => {
  for (const fail of [/default_branch/, /git\/ref/, /git\/trees/]) {
    assert.deepEqual(await find(['CONTEXT.md'], { fail }),
      { status: 502, error: "Can't read maddec01/lar-web's default branch: gh api failed: HTTP 502: Bad Gateway" }, String(fail));
  }
});

test('a tree too big for GitHub to list in full returns that problem', async () => {
  assert.deepEqual(await find(['CONTEXT.md'], { truncated: true }),
    { status: 502, error: "Can't read maddec01/lar-web's default branch: GitHub listed only part of its files, since it has too many." });
});

const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';

test('on Azure Repos, the fixed checks read the default branch through az, with no gh call', async () => {
  const az = fakeAzRepos({ files: { '/CONTEXT.md': '', '/.scratch/a.md': '', '/.claude/skills/tdd/SKILL.md': '', '/README.md': '' } });
  const found = await findFixedClashes({ repo: AZURE }, az.run, () => BUNDLED) as { clashes: { id: string }[]; skillClashes: unknown; projectSkills: unknown };
  assert.deepEqual(found.clashes.map((clash) => clash.id), ['context', 'scratch']);
  assert.deepEqual(found.skillClashes, [{ name: 'tdd', path: '.claude/skills/tdd/' }]);
  assert.deepEqual(found.projectSkills, ['tdd']);
  assert.ok(az.calls.every((args) => args[0] === 'repos' || args[0] === 'devops'));
  assert.ok(az.calls.filter((args) => args[1] === 'invoke').every((args) => args.includes('--api-version')));
});

test('a tree Azure DevOps lists only in part returns that problem', async () => {
  assert.deepEqual(await findFixedClashes({ repo: AZURE }, fakeAzRepos({ files: { '/CONTEXT.md': '' }, partialTree: true }).run, () => BUNDLED),
    { status: 502, error: `Can't read ${AZURE}'s default branch: Azure DevOps listed only part of its files, since it has too many.` });
});

test("unreadable bundled skills return the problem, and a body without a repository is refused", async () => {
  const unreadable = await findFixedClashes({ repo: 'maddec01/lar-web' }, ghWith([]).run, () => { throw new Error('ENOENT skills'); });
  assert.deepEqual(unreadable, { status: 500, error: "Can't read the app's bundled skills: ENOENT skills" });
  assert.deepEqual(await findFixedClashes({}, ghWith([]).run, () => BUNDLED), { status: 400, error: 'Send the repository to check.' });
});
