import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { RepositoryItemSource } from '@lar-factory/shared';
import type { Checkout } from '../t3/repository-project.ts';
import { type SetupCheckReads, runSetupCheck } from './setup-checks.ts';

const WEB: Checkout = { id: 'web', title: 'lar-web', folder: '/Users/me/Developer/lar-web', origin: 'git@github.com:maddec01/lar-web.git' };
const PROJECT: RepositoryItemSource = { kind: 'github-project', owner: 'maddec01', number: 3 };

/** Reads that find `projects` as T3's, read the item source's items as `items` and answer `push` for the permission. */
function reads(parts: Partial<SetupCheckReads> = {}): SetupCheckReads {
  return { checkouts: async () => [WEB], countItems: async () => 23, canPush: async () => true, ...parts };
}

const check = (input: Record<string, unknown>, parts?: Partial<SetupCheckReads>) =>
  runSetupCheck({ repo: 'maddec01/lar-web', projectId: 'web', itemSource: PROJECT, ...input }, reads(parts));

test("the main checkout check passes for the picked T3 project whose folder's origin is the repository", async () => {
  assert.deepEqual(await check({ check: 'checkout' }), { result: { passed: true, detail: '/Users/me/Developer/lar-web · origin maddec01/lar-web' } });
});

test('the main checkout check fails with its fix for a worktree, another origin, a second checkout or a gone project', async () => {
  const failed = async (projects: Checkout[]) => {
    const { result } = await check({ check: 'checkout' }, { checkouts: async () => projects }) as { result: { problem: string; fix: string } };
    return `${result.problem} | ${result.fix}`;
  };
  assert.equal(await failed([{ ...WEB, origin: null }]),
    "/Users/me/Developer/lar-web isn't a main checkout with an origin. | Pick the T3 project of maddec01/lar-web's main checkout, not a worktree.");
  assert.equal(await failed([{ ...WEB, origin: 'https://github.com/maddec01/lar-cli.git' }]),
    "/Users/me/Developer/lar-web's origin is maddec01/lar-cli, not maddec01/lar-web. | Go Back and pick the T3 project of maddec01/lar-web's main checkout.");
  assert.equal(await failed([WEB, { ...WEB, id: 'web-2', folder: '/Users/me/lar-web' }]),
    'Several T3 projects are checkouts of maddec01/lar-web: /Users/me/Developer/lar-web, /Users/me/lar-web. | Remove all but one in T3 Code, then Retry.');
  assert.equal(await failed([]), 'T3 Code no longer has the picked T3 project. | Go Back and pick one.');
});

test("the main checkout check names T3's problem when its projects can't be read", async () => {
  const { result } = await check({ check: 'checkout' }, { checkouts: async () => { throw new Error('no state.sqlite'); } }) as { result: unknown };
  assert.deepEqual(result, { passed: false, problem: "Can't read T3 Code's projects: no state.sqlite", fix: 'Open T3 Code, then Retry.' });
});

test('the item source check reads the GitHub Project or the issues and counts their items', async () => {
  const sources: [RepositoryItemSource, string][] = [];
  const countItems = async (source: RepositoryItemSource, repo: string) => { sources.push([source, repo]); return 23; };
  assert.deepEqual(await check({ check: 'source' }, { countItems }), { result: { passed: true, detail: 'GitHub Project maddec01 #3 has 23 items to show' } });
  assert.deepEqual(await check({ check: 'source', itemSource: { kind: 'issues' } }, { countItems }),
    { result: { passed: true, detail: "maddec01/lar-web's issues have 23 items to show" } });
  assert.deepEqual(sources, [[PROJECT, 'maddec01/lar-web'], [{ kind: 'issues' }, 'maddec01/lar-web']]);
});

test("an item source that can't be read shows gh's message and how to fix it", async () => {
  const { result } = await check({ check: 'source' }, { countItems: async () => { throw new Error('Project maddec01/3 not found'); } }) as { result: unknown };
  assert.deepEqual(result, { passed: false, problem: "Can't read GitHub Project maddec01 #3: Project maddec01/3 not found",
    fix: "Check the Project's owner and number, and that gh's login can read the Project." });
});

test("the push check passes when gh's login can push, and names the fix when it can't", async () => {
  assert.deepEqual(await check({ check: 'push' }), { result: { passed: true, detail: "gh's login can push to maddec01/lar-web" } });
  assert.deepEqual(await check({ check: 'push' }, { canPush: async () => false }), { result: { passed: false,
    problem: "gh's login can't push to maddec01/lar-web, so lar-work's agents can't push their branches.",
    fix: 'Get write access to maddec01/lar-web, or log gh in as an account that has it:', command: 'gh auth login' } });
  const { result } = await check({ check: 'push' }, { canPush: async () => { throw new Error('gh api failed: HTTP 404'); } }) as { result: unknown };
  assert.deepEqual(result, { passed: false, problem: "Can't read maddec01/lar-web's permissions: gh api failed: HTTP 404",
    fix: "Check that gh's login can read maddec01/lar-web, then Retry." });
});

test('a body without a known check, its repository, its T3 project or its item source is refused', async () => {
  for (const input of [{ check: 'labels' }, { check: 'checkout', projectId: 3 }, { check: 'source', itemSource: { kind: 'github-project', owner: 'x' } },
    { check: 'push', repo: '../x' }]) {
    assert.deepEqual(await check(input), { status: 400, error: 'Send the check to run, the repository, its T3 project and its item source.' }, JSON.stringify(input));
  }
});
