import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { RepositoryItemSource } from '@lar-factory/shared';
import { fakeAz, fakeAzRepos, type WorkItem } from '../azure/fake-az.ts';
import type { Checkout } from '../t3/repository-project.ts';
import { type SetupCheckReads, runSetupCheck, setupCheckReads } from './setup-checks.ts';

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

const API: Checkout = { id: 'api', title: 'lar-api', folder: '/Users/me/Developer/lar-api', origin: 'git@ssh.dev.azure.com:v3/contoso/Fabrikam%20Fiber/lar-api' };
const AZURE_REPO = 'contoso/Fabrikam%20Fiber/lar-api';
/** AZURE_REPO as the checks' text names it, decoded. */
const SHOWN_REPO = 'contoso/Fabrikam Fiber/lar-api';
const SPRINT: RepositoryItemSource = { kind: 'azure-sprint', team: 'Fabrikam Team' };
const ITEMS: WorkItem[] = [
  { id: 1, type: 'User Story', state: 'Active', title: 'Seek' },
  { id: 11, type: 'Task', state: 'Active', parent: 1 },
  { id: 2, type: 'User Story', state: 'New', title: 'Ship' },
];

/** Runs a check on lar-api through `run` as az, with lar-api as T3's only project. */
const azureCheck = (input: Record<string, unknown>, run: (args: string[]) => Promise<string>) =>
  runSetupCheck({ repo: AZURE_REPO, projectId: 'api', itemSource: SPRINT, ...input }, { ...setupCheckReads(run), checkouts: async () => [API] });

test("the main checkout check reads an Azure DevOps origin as organization/project/repository", async () => {
  assert.deepEqual(await azureCheck({ check: 'checkout' }, fakeAzRepos().run),
    { result: { passed: true, detail: '/Users/me/Developer/lar-api · origin contoso/Fabrikam Fiber/lar-api' } });
});

test("the item source check counts an Azure DevOps team's sprint or backlog through az", async () => {
  const az = fakeAz({ items: ITEMS });
  assert.deepEqual(await azureCheck({ check: 'source' }, az.run), { result: { passed: true, detail: 'Fabrikam Team’s current sprint has 2 items to show' } });
  assert.deepEqual(await azureCheck({ check: 'source', itemSource: { kind: 'azure-backlog', team: 'Fabrikam Team' } }, az.run),
    { result: { passed: true, detail: 'Fabrikam Team’s backlog has 2 items to show' } });
});

test("an Azure DevOps item source az can't read shows az's message, with az login for a logged-out az", async () => {
  const failing = (message: string) => fakeAz({ items: ITEMS, fail: () => new Error(message) }).run;
  assert.deepEqual(await azureCheck({ check: 'source' }, failing("az boards failed: TF400898: team 'Nobody' not found")), { result: { passed: false,
    problem: "Can't read Fabrikam Team’s current sprint: az boards failed: TF400898: team 'Nobody' not found",
    fix: "Check the team's name, and that az's login can read Fabrikam Fiber's boards." } });
  assert.deepEqual(await azureCheck({ check: 'source' }, failing('Please run az login to setup account.')), { result: { passed: false,
    problem: "Can't read Fabrikam Team’s current sprint: az is logged out.", fix: 'Run this, then Retry:', command: 'az login' } });
});

test('a team with no current iteration names its sprint fix, or going Back to name another team', async () => {
  assert.deepEqual(await azureCheck({ check: 'source' }, fakeAz({ items: ITEMS, iterations: [] }).run), { result: { passed: false,
    problem: "Can't read Fabrikam Team’s current sprint: Team Fabrikam Team has no current iteration in contoso/Fabrikam Fiber.",
    fix: 'Give the team a sprint whose dates cover today in its project settings, then Retry, or go Back and name another team.' } });
});

test("the push check asks Azure DevOps whether az's login can contribute to the repository", async () => {
  assert.deepEqual(await azureCheck({ check: 'push' }, fakeAzRepos().run), { result: { passed: true, detail: `az's login can push to ${SHOWN_REPO}` } });
  assert.deepEqual(await azureCheck({ check: 'push' }, fakeAzRepos({ canPush: false }).run), { result: { passed: false,
    problem: `az's login can't push to ${SHOWN_REPO}, so lar-work's agents can't push their branches.`,
    fix: `Get Contribute on ${SHOWN_REPO}, or log az in as an account that has it:`, command: 'az login' } });
  const { result } = await azureCheck({ check: 'push' }, fakeAzRepos({ fail: () => new Error('az repos show failed: TF401019: no repository') }).run) as { result: unknown };
  assert.deepEqual(result, { passed: true, detail: `Warning: couldn't check ${SHOWN_REPO}'s push permission: az repos show failed: TF401019: no repository. You can continue; agents will need Contribute permission to push.` });
});

test('a malformed Azure request names a request problem without blaming the team or login', async () => {
  const answer = await azureCheck({ check: 'source' }, fakeAz({ items: ITEMS, fail: () => new Error('ERROR: The request is invalid.') }).run);
  assert.deepEqual(answer, { result: { passed: false, problem: "Can't read Fabrikam Team’s current sprint: ERROR: The request is invalid.", fix: 'Azure DevOps rejected the board’s request. Retry, and report this request error if it persists.' } });
});

test('an empty Azure permission evaluation is inconclusive and allows continuing with a warning', async () => {
  const az = fakeAzRepos();
  const answer = await azureCheck({ check: 'push' }, async (args) => args[0] === 'rest' ? '{"count":0,"value":[]}' : az.run(args));
  assert.deepEqual(answer, { result: { passed: true, detail: `Warning: couldn't check ${SHOWN_REPO}'s push permission: Azure DevOps returned no push permission decision. You can continue; agents will need Contribute permission to push.` } });
});
