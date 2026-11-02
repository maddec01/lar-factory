// Settings' Labels section: label changes go to the tracker through its adapter and only with management access.
import { afterEach, expect, test, vi, type TestContext } from 'vite-plus/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPOSITORY_OPERATIONS, trackerCapabilities, type OperationAccess, type TrackerCapabilities, type TrackerLabel, type TrackerLabels } from '@lar-factory/shared';
import { trackerLabels } from '@lar-factory/shared/tracker-labels';
import { fakeAz } from '../azure/fake-az.ts';
import { saveOnboarded } from './repository-config.ts';
import { changeRepositoryLabels } from './repository-labels.ts';
import { readRepositorySetups, replaceAccess, setVocabularyOverride } from '@lar-factory/shared/repository-settings';

const REPO = 'team/app';
const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';

afterEach(() => { vi.unstubAllEnvs(); });

/** A data folder listing `repo`, with `access` to manage its labels. */
async function folder(t: TestContext, repo = REPO, access: OperationAccess = 'allowed') {
  const dir = await mkdtemp(join(tmpdir(), 'repository-labels-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  saveOnboarded(repo, null, dir);
  replaceAccess(repo, { ...Object.fromEntries(REPOSITORY_OPERATIONS.map((op) => [op, 'allowed' as const])), 'manage-labels': access === 'unverified' ? undefined : access }, dir);
  return dir;
}

/** A tracker the factory has no adapter for, keeping its labels in memory. */
function thirdTracker(start: TrackerLabel[] = [{ name: 'docs' }]) {
  let labels = start;
  const tracker: TrackerLabels = {
    list: async () => labels,
    create: async (label) => { labels = [...labels, label]; return label; },
    update: async (name, change) => { labels = labels.map((l) => l.name === name ? { ...l, ...change } : l); return labels.find((l) => l.name === (change.name ?? name))!; },
    delete: async (name) => { labels = labels.filter((l) => l.name !== name); },
    addToTicket: async () => {}, removeFromTicket: async () => {},
  };
  const capabilities: TrackerCapabilities = { ...trackerCapabilities(REPO), noun: 'sticker', heading: 'Stickers', description: false };
  return { labels: tracker, capabilities };
}

test('a fake third tracker lists, creates, renames and deletes through its adapter alone', async (t) => {
  const dir = await folder(t);
  const tracker = thirdTracker();
  const change = (body: object) => changeRepositoryLabels({ repo: REPO, ...body }, dir, tracker);
  expect(await change({ change: 'list' })).toEqual({ labels: [{ name: 'docs' }] });
  expect(await change({ change: 'create', name: ' area-ui ' })).toEqual({});
  expect(await change({ change: 'update', name: 'docs', update: { name: 'guides' } })).toEqual({});
  expect(await change({ change: 'list' })).toEqual({ labels: [{ name: 'guides' }, { name: 'area-ui' }] });
  expect(await change({ change: 'delete', name: 'guides' })).toEqual({});
  expect(await change({ change: 'list' })).toEqual({ labels: [{ name: 'area-ui' }] });
});

test('managed names are refused with the reason, whether typed or already on the tracker', async (t) => {
  const dir = await folder(t);
  const tracker = thirdTracker([{ name: 'bug' }, { name: 'docs' }]);
  const change = (body: object) => changeRepositoryLabels({ repo: REPO, ...body }, dir, tracker);
  expect(await change({ change: 'create', name: 'linked-work' })).toEqual({ status: 400, error: "linked-work is reserved for the factory's saved links." });
  expect(await change({ change: 'update', name: 'docs', update: { name: 'status-done' } })).toEqual({ status: 400, error: 'status-done is reserved for board status.' });
  expect(await change({ change: 'update', name: 'bug', update: { name: 'defects' } })).toEqual({ status: 400, error: "bug is reserved for the item's kind." });
  expect(await change({ change: 'delete', name: 'Bug' })).toEqual({ status: 400, error: "Bug is reserved for the item's kind." });
  expect(await tracker.labels.list()).toEqual([{ name: 'bug' }, { name: 'docs' }]);
});

test("Azure's repo- tags are locked, and GitHub's repo- labels are ordinary", async (t) => {
  const azureDir = await folder(t, AZURE);
  const az = fakeAz({ items: [], tags: ['repo-lar-api', 'docs'] });
  const azure = { labels: trackerLabels(AZURE, { az: az.run, gh: async () => { throw new Error('gh is not for an Azure repository'); } }), capabilities: trackerCapabilities(AZURE) };
  const onAzure = (body: object) => changeRepositoryLabels({ repo: AZURE, ...body }, azureDir, azure);
  const reserved = "repo-lar-api is reserved for the work item's repository.";
  expect(await onAzure({ change: 'delete', name: 'repo-lar-api' })).toEqual({ status: 400, error: reserved });
  expect(await onAzure({ change: 'update', name: 'repo-lar-api', update: { name: 'docs-two' } })).toEqual({ status: 400, error: reserved });
  expect(await onAzure({ change: 'update', name: 'docs', update: { name: 'repo-other' } })).toEqual({ status: 400, error: "repo-other is reserved for the work item's repository." });
  expect(az.tags).toEqual(['repo-lar-api', 'docs']);

  const github = thirdTracker([{ name: 'repo-web' }]);
  github.capabilities = trackerCapabilities(REPO);
  expect(await changeRepositoryLabels({ repo: REPO, change: 'update', name: 'repo-web', update: { name: 'repo-site' } }, await folder(t), github)).toEqual({});
});

test('changes that the capability rules out are refused before the adapter runs', async (t) => {
  const dir = await folder(t);
  const tracker = thirdTracker();
  const change = (body: object) => changeRepositoryLabels({ repo: REPO, ...body }, dir, tracker);
  expect(await change({ change: 'update', name: 'docs', update: { description: 'Guides' } })).toMatchObject({ status: 400 });
  expect(await change({ change: 'update', name: 'docs', update: { color: 'not a colour' } })).toMatchObject({ status: 400 });
  expect(await change({ change: 'rename', name: 'docs' })).toMatchObject({ status: 400 });
  expect(await tracker.labels.list()).toEqual([{ name: 'docs' }]);
  const noCreate = { ...tracker, capabilities: { ...tracker.capabilities, createUnavailable: 'Stickers appear on first use.' } };
  expect(await changeRepositoryLabels({ repo: REPO, change: 'create', name: 'new' }, dir, noCreate)).toEqual({ status: 400, error: 'Stickers appear on first use.' });
});

for (const access of ['refused', 'unverified'] as const) test(`reading works and writing is refused when label management is ${access}`, async (t) => {
  const dir = await folder(t, REPO, access);
  const tracker = thirdTracker();
  expect(await changeRepositoryLabels({ repo: REPO, change: 'list' }, dir, tracker)).toEqual({ labels: [{ name: 'docs' }] });
  for (const body of [{ change: 'create', name: 'new' }, { change: 'update', name: 'docs', update: { name: 'new' } }, { change: 'delete', name: 'docs' }]) {
    expect(await changeRepositoryLabels({ repo: REPO, ...body }, dir, tracker)).toMatchObject({ status: 400, error: expect.stringContaining('manage-labels') });
  }
  expect(await tracker.labels.list()).toEqual([{ name: 'docs' }]);
});

test('a repository not on this Mac and a bad request are refused', async (t) => {
  const dir = await folder(t);
  expect(await changeRepositoryLabels({ repo: 'else/app', change: 'list' }, dir, thirdTracker())).toMatchObject({ status: 409 });
  expect(await changeRepositoryLabels({ change: 'list' }, dir, thirdTracker())).toMatchObject({ status: 400 });
});

test("a failed read reports the tracker's reason", async (t) => {
  const dir = await folder(t);
  const tracker = thirdTracker();
  expect(await changeRepositoryLabels({ repo: REPO, change: 'list' }, dir, { ...tracker, labels: { ...tracker.labels, list: () => Promise.reject(new Error('The tracker is down.')) } }))
    .toEqual({ status: 400, error: 'The tracker is down.' });
});

test('on Azure a comma is refused, and rename and delete reach the fake az', async (t) => {
  const dir = await folder(t, AZURE);
  const az = fakeAz({ items: [], tags: ['old name', 'gone'] });
  const tracker = { labels: trackerLabels(AZURE, { az: az.run, gh: () => Promise.reject(new Error('gh is not for Azure')) }), capabilities: trackerCapabilities(AZURE) };
  const change = (body: object) => changeRepositoryLabels({ repo: AZURE, ...body }, dir, tracker);
  expect(await change({ change: 'update', name: 'old name', update: { name: 'a,b' } })).toEqual({ status: 400, error: 'Use a tag name without commas or semicolons.' });
  expect(await change({ change: 'create', name: 'new' })).toEqual({ status: 400, error: trackerCapabilities(AZURE).createUnavailable });
  expect(await change({ change: 'update', name: 'old name', update: { name: 'new name' } })).toEqual({});
  expect(await change({ change: 'delete', name: 'gone' })).toEqual({});
  expect(await change({ change: 'list' })).toEqual({ labels: [{ name: 'new name' }] });
});

test('LAR_FACTORY_AZURE_READ_ONLY=1 refuses Azure label writes and still reads', async (t) => {
  const dir = await folder(t, AZURE);
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
  const az = fakeAz({ items: [], tags: ['docs'] });
  const tracker = { labels: trackerLabels(AZURE, { az: az.run, gh: () => Promise.reject(new Error('gh is not for Azure')) }), capabilities: trackerCapabilities(AZURE) };
  expect(await changeRepositoryLabels({ repo: AZURE, change: 'delete', name: 'docs' }, dir, tracker)).toEqual({ status: 400, error: 'Azure DevOps is read-only in this test session.' });
  expect(await changeRepositoryLabels({ repo: AZURE, change: 'list' }, dir, tracker)).toEqual({ labels: [{ name: 'docs' }] });
});

const AZURE_SIBLING = 'Contoso/fabrikam%20fiber/lar-web';
const AZURE_ELSEWHERE = 'contoso/Other/lar-api';

const bugLabels = (dir: string, repo: string) => readRepositorySetups(dir).find((s) => s.repo === repo)?.vocabulary.bug.labels;

/** `dir` also listing `repos`, with each mapping Bug to `labels`. */
function alsoListed(dir: string, repos: string[], labels: string[]) {
  for (const repo of repos) {
    saveOnboarded(repo, null, dir);
    setVocabularyOverride(repo, 'bug', { type: null, labels }, dir);
  }
}

test('renaming a mapped label updates every kind mapping it, matching without case, and sends back the changed setup', async (t) => {
  const dir = await folder(t);
  setVocabularyOverride(REPO, 'bug', { type: 'Bug', labels: ['Docs', 'triage'] }, dir);
  setVocabularyOverride(REPO, 'feature', { type: null, labels: ['docs'] }, dir);
  setVocabularyOverride(REPO, 'improvement', { type: null, labels: ['triage'] }, dir);
  const tracker = thirdTracker([{ name: 'docs' }, { name: 'triage' }]);
  const changed = await changeRepositoryLabels({ repo: REPO, change: 'update', name: 'docs', update: { name: 'guides' } }, dir, tracker);
  const [setup] = readRepositorySetups(dir);
  expect(setup!.vocabulary).toMatchObject({ bug: { type: 'Bug', labels: ['guides', 'triage'] }, feature: { labels: ['guides'] }, improvement: { labels: ['triage'] } });
  expect(changed).toEqual({ setups: [setup] });
});

test('a colour change and a label no kind maps leave mappings alone', async (t) => {
  const dir = await folder(t);
  setVocabularyOverride(REPO, 'bug', { type: null, labels: ['docs'] }, dir);
  const tracker = { ...thirdTracker([{ name: 'docs' }, { name: 'other' }]), capabilities: trackerCapabilities(REPO) };
  expect(await changeRepositoryLabels({ repo: REPO, change: 'update', name: 'docs', update: { color: '00ff00' } }, dir, tracker)).toEqual({});
  expect(await changeRepositoryLabels({ repo: REPO, change: 'delete', name: 'other' }, dir, tracker)).toEqual({});
  expect(bugLabels(dir, REPO)).toEqual(['docs']);
});

test('deleting a mapped label removes it from the mapping and keeps the rest', async (t) => {
  const dir = await folder(t);
  setVocabularyOverride(REPO, 'bug', { type: 'Bug', labels: ['docs', 'triage'] }, dir);
  const tracker = thirdTracker([{ name: 'docs' }, { name: 'triage' }]);
  expect(await changeRepositoryLabels({ repo: REPO, change: 'delete', name: 'docs' }, dir, tracker)).toMatchObject({ setups: [{ repo: REPO }] });
  expect(readRepositorySetups(dir)[0]!.vocabulary.bug).toEqual({ type: 'Bug', labels: ['triage'] });
});

test('a refused tracker change leaves mappings as they were', async (t) => {
  const dir = await folder(t);
  setVocabularyOverride(REPO, 'bug', { type: null, labels: ['docs'] }, dir);
  const tracker = thirdTracker();
  const refusing = { ...tracker, labels: { ...tracker.labels, delete: () => Promise.reject(new Error('The tracker refused.')) } };
  expect(await changeRepositoryLabels({ repo: REPO, change: 'delete', name: 'docs' }, dir, refusing)).toEqual({ status: 400, error: 'The tracker refused.' });
  expect(bugLabels(dir, REPO)).toEqual(['docs']);
});

test('on GitHub a change stays in its repository, even under the same owner', async (t) => {
  const dir = await folder(t);
  setVocabularyOverride(REPO, 'bug', { type: null, labels: ['docs'] }, dir);
  alsoListed(dir, ['team/other'], ['docs']);
  const tracker = { ...thirdTracker(), capabilities: trackerCapabilities(REPO) };
  await changeRepositoryLabels({ repo: REPO, change: 'update', name: 'docs', update: { name: 'guides' } }, dir, tracker);
  expect(bugLabels(dir, REPO)).toEqual(['guides']);
  expect(bugLabels(dir, 'team/other')).toEqual(['docs']);
});

test('renaming an Azure tag updates mappings in the project\'s other repositories, and no other project', async (t) => {
  const dir = await folder(t, AZURE);
  setVocabularyOverride(AZURE, 'bug', { type: null, labels: ['old name'] }, dir);
  alsoListed(dir, [AZURE_SIBLING, AZURE_ELSEWHERE], ['old name']);
  const az = fakeAz({ items: [], tags: ['old name'] });
  const tracker = { labels: trackerLabels(AZURE, { az: az.run, gh: () => Promise.reject(new Error('gh is not for Azure')) }), capabilities: trackerCapabilities(AZURE) };
  const changed = await changeRepositoryLabels({ repo: AZURE, change: 'update', name: 'old name', update: { name: 'new name' } }, dir, tracker);
  expect(bugLabels(dir, AZURE)).toEqual(['new name']);
  expect(bugLabels(dir, AZURE_SIBLING)).toEqual(['new name']);
  expect(bugLabels(dir, AZURE_ELSEWHERE)).toEqual(['old name']);
  expect(changed).toMatchObject({ setups: [{ repo: AZURE }, { repo: AZURE_SIBLING }] });
});

test('deleting an Azure tag removes it from the project\'s mappings, and from no other project\'s', async (t) => {
  const dir = await folder(t, AZURE);
  setVocabularyOverride(AZURE, 'bug', { type: null, labels: ['gone', 'kept'] }, dir);
  alsoListed(dir, [AZURE_SIBLING, AZURE_ELSEWHERE], ['gone']);
  const az = fakeAz({ items: [], tags: ['gone', 'kept'] });
  const tracker = { labels: trackerLabels(AZURE, { az: az.run, gh: () => Promise.reject(new Error('gh is not for Azure')) }), capabilities: trackerCapabilities(AZURE) };
  await changeRepositoryLabels({ repo: AZURE, change: 'delete', name: 'gone' }, dir, tracker);
  expect(bugLabels(dir, AZURE)).toEqual(['kept']);
  expect(bugLabels(dir, AZURE_SIBLING)).toEqual([]);
  expect(bugLabels(dir, AZURE_ELSEWHERE)).toEqual(['gone']);
});

test('an Azure tag change leaves a GitHub repository named like the project alone', async (t) => {
  const dir = await folder(t, AZURE_ELSEWHERE);
  setVocabularyOverride(AZURE_ELSEWHERE, 'bug', { type: null, labels: ['gone'] }, dir);
  alsoListed(dir, ['contoso/Other'], ['gone']);
  const tracker = { ...thirdTracker([{ name: 'gone' }]), capabilities: trackerCapabilities(AZURE_ELSEWHERE) };
  await changeRepositoryLabels({ repo: AZURE_ELSEWHERE, change: 'delete', name: 'gone' }, dir, tracker);
  expect(bugLabels(dir, AZURE_ELSEWHERE)).toEqual([]);
  expect(bugLabels(dir, 'contoso/Other')).toEqual(['gone']);
});

test('a list that cannot be saved says the tracker already changed', async (t) => {
  const dir = await folder(t);
  setVocabularyOverride(REPO, 'bug', { type: null, labels: ['docs'] }, dir);
  const tracker = thirdTracker();
  const breaking = { ...tracker, labels: { ...tracker.labels, delete: () => writeFile(join(dir, 'repository-settings.json'), 'not json') } };
  expect(await changeRepositoryLabels({ repo: REPO, change: 'delete', name: 'docs' }, dir, breaking)).toEqual({ status: 400, error: expect.stringMatching(/^The tracker made this change, but kind mappings did not follow\. /) });
});
