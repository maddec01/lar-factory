// Settings' Labels section: label changes go to the tracker through its adapter and only with management access.
import { afterEach, expect, test, vi, type TestContext } from 'vite-plus/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPOSITORY_OPERATIONS, trackerCapabilities, type OperationAccess, type TrackerCapabilities, type TrackerLabel, type TrackerLabels } from '@lar-factory/shared';
import { trackerLabels } from '@lar-factory/shared/tracker-labels';
import { fakeAz } from '../azure/fake-az.ts';
import { saveOnboarded } from './repository-config.ts';
import { changeRepositoryLabels } from './repository-labels.ts';
import { replaceAccess } from '@lar-factory/shared/repository-settings';

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
