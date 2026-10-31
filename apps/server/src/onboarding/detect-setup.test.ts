import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { SetupDetection } from '@lar-factory/shared';
import type { Checkout } from '../t3/repository-project.ts';
import { type DetectReads, detectSetup } from './detect-setup.ts';

const WEB: Checkout = { id: 'web', title: 'lar-web', folder: '/Users/me/Developer/lar-web', origin: 'git@github.com:maddec01/lar-web.git' };
const AZURE: Checkout = { id: 'shop', title: 'shop', folder: '/Users/me/shop', origin: 'git@ssh.dev.azure.com:v3/contoso/Retail/shop' };

/** Reads that find `files`, by path with their text, on the default branch, and the other facts as `parts` say. */
function reads(files: Record<string, string> = {}, parts: Partial<DetectReads> = {}): DetectReads {
  return {
    checkouts: async () => [WEB, AZURE],
    tree: async () => ({
      tree: { sha: 'tree0', files: new Map(Object.keys(files).map((path) => [path, { mode: '100644', sha: path }])) },
    }),
    github: async () => ({ push: true, triage: true, issues: true, tokenWrites: true }),
    azurePush: async () => true,
    teams: async () => ['Retail Team', 'Platform'],
    ...parts,
  };
}

const detect = async (files?: Record<string, string>, parts?: Partial<DetectReads>, input: Record<string, unknown> = {}) => {
  const answer = await detectSetup({ repo: 'maddec01/lar-web', projectId: 'web', ...input }, reads(files, parts));
  return (answer as { detection: SetupDetection }).detection;
};

test('detection reads doc and skill paths without reading factory configuration or instructions', async () => {
  const found = reads({ 'GLOSSARY.md': '', 'docs/adr/one.md': '', '.agents/skills/local/SKILL.md': '', 'AGENTS.md': '', '.lar-factory.json': '' });
  const tree = found.tree;
  found.tree = async (repo) => ({ ...await tree(repo), read: async () => { throw new Error('No file content should be read'); } });
  const result = await detectSetup({ repo: 'maddec01/lar-web', projectId: 'web' }, found) as { detection: SetupDetection };
  assert.deepEqual(result.detection.domainDocs, { found: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' } });
  assert.deepEqual(result.detection.projectSkills, { found: ['local'] });
  assert.ok(!('factoryFiles' in result.detection));
  assert.ok(!('sharedConfig' in result.detection));
  assert.ok(Object.values(result.detection.access).every((access) => access === 'allowed'));
});

test("a login without push or triage access marks those operations Refused and leaves what it can't settle unverified", async () => {
  const detection = await detect({}, { github: async () => ({ push: false, triage: false, issues: true }) });
  assert.deepEqual(detection.access,
    { 'push-branch': 'refused', 'open-pr': 'unverified', 'publish-ticket': 'unverified', 'edit-ticket': 'unverified', 'tag-ticket': 'refused', 'comment-ticket': 'unverified', 'type-ticket': 'unverified', 'relate-ticket': 'unverified' });
});

test("a repository with issues turned off has its issues Refused, and one the login can't read Refuses every fact it reads", async () => {
  const off = await detect({}, { github: async () => ({ push: true, triage: true, issues: false }) });
  assert.deepEqual([off.itemSources, off.access['publish-ticket']], [{ refused: 'maddec01/lar-web has issues turned off.' }, 'refused']);
  const blocked = await detect({}, {
    github: async () => { throw new Error('HTTP 404: Not Found'); },
    tree: async () => { throw new Error('HTTP 404: Not Found'); },
  });
  const refused = { refused: "Can't read maddec01/lar-web with gh: HTTP 404: Not Found" };
  assert.deepEqual([blocked.itemSources, blocked.domainDocs, blocked.projectSkills],
    [refused, refused, refused]);
  assert.deepEqual(Object.values(blocked.access), ['unverified', 'unverified', 'unverified', 'unverified', 'unverified', 'unverified', 'unverified', 'unverified']);
});

test("an Azure DevOps repository detects its teams' boards and push access, with ticket access unverified", async () => {
  const repo = 'contoso/Retail/shop';
  const detection = await detect({}, {}, { repo, projectId: 'shop' });
  assert.deepEqual([detection.provider, detection.checkout, detection.itemSources], ['Azure DevOps', { found: '/Users/me/shop' },
    { found: [{ kind: 'azure-board', team: 'Retail Team' }, { kind: 'azure-board', team: 'Platform' }] }]);
  assert.deepEqual(detection.access,
    { 'push-branch': 'allowed', 'open-pr': 'unverified', 'publish-ticket': 'unverified', 'edit-ticket': 'unverified', 'tag-ticket': 'unverified', 'comment-ticket': 'unverified', 'type-ticket': 'unverified', 'relate-ticket': 'unverified' });
  const refused = await detect({}, { azurePush: async () => false, teams: async () => { throw new Error('TF400813: not authorized'); } }, { repo, projectId: 'shop' });
  assert.deepEqual([refused.access['push-branch'], refused.access['open-pr'], refused.itemSources],
    ['refused', 'unverified', { refused: "Can't read contoso/Retail/shop's teams with az: TF400813: not authorized" }]);
});

test("the checkout is Refused with its fix for another origin, a second checkout or T3's projects unread", async () => {
  const checkout = async (projects: () => Promise<Checkout[]>) => (await detect({}, { checkouts: projects })).checkout;
  assert.deepEqual(await checkout(async () => [{ ...WEB, origin: 'https://github.com/maddec01/lar-cli.git' }]),
    { refused: '/Users/me/Developer/lar-web connects to maddec01/lar-cli instead of maddec01/lar-web. Go back and choose the main repository folder for maddec01/lar-web.' });
  assert.deepEqual(await checkout(async () => [WEB, { ...WEB, id: 'web-2', folder: '/Users/me/lar-web' }]),
    { refused: 'More than one T3 project points to maddec01/lar-web. The folders are /Users/me/Developer/lar-web, /Users/me/lar-web. Keep one project in T3 Code, then retry.' });
  assert.deepEqual(await checkout(async () => { throw new Error('no state.sqlite'); }),
    { refused: "Can't read T3 Code's projects: no state.sqlite. Open T3 Code, then retry." });
});

test('detection refuses a body without a repository and T3 project', async () => {
  assert.deepEqual(await detectSetup({ repo: 'nope' }, reads()), { status: 400, error: 'Choose a repository and its T3 project before detecting its setup.' });
});

test('a push-capable user with an unverified token gets no positive write access', async () => {
  const detection = await detect({}, { github: async () => ({ push: true, triage: true, issues: true }) });
  assert.ok(Object.values(detection.access).every((access) => access === 'unverified'));
  assert.deepEqual(detection.itemSources, { found: [{ kind: 'issues' }] });
});
