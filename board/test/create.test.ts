import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addProjectItem } from '../src/github.ts';
import { loadConfig } from '../src/config.ts';
import type { CreationProgress } from '../src/add-item.ts';

test('creates an Apple issue with the selected labels and explicitly assigns List', async () => {
  const calls: string[][] = [];
  const replies = [
    { id: 'PVT_1' },
    { fields: [{ id: 'FIELD_1', name: 'Status', options: [{ id: 'LIST_1', name: 'List' }] }] },
    { number: 81, html_url: 'https://github.com/maddec01/mux-apple/issues/81', updated_at: '2026-10-21T10:00:00Z' },
    { id: 'PVTI_81' },
    {},
  ];
  const result = await addProjectItem({ ...loadConfig(), number: 1 }, {
    repo: 'maddec01/mux-apple', kind: 'bug', title: 'Playback stalls', description: 'After seeking.',
    labels: ['app: music', 'app: books', 'os: ios'],
  }, {}, async (args: string[]) => {
    calls.push(args);
    return JSON.stringify(replies.shift());
  });
  assert.equal(result.error, null);
  assert.equal(result.item?.status, 'List');
  assert.equal(result.item?.id, 'PVTI_81');
  assert.deepEqual(result.item?.labels, ['bug', 'app: music', 'app: books', 'os: ios']);
  assert.deepEqual(calls[2], ['api', '--method', 'POST', 'repos/maddec01/mux-apple/issues',
    '-f', 'title=Playback stalls', '-f', 'body=After seeking.', '-f', 'labels[]=bug',
    '-f', 'labels[]=app: music', '-f', 'labels[]=app: books', '-f', 'labels[]=os: ios']);
  assert.deepEqual(calls[4], ['project', 'item-edit', '--project-id', 'PVT_1', '--id', 'PVTI_81',
    '--field-id', 'FIELD_1', '--single-select-option-id', 'LIST_1']);
});

test('rejects invalid repositories, kinds, blank titles and labels from another repository before GitHub', async () => {
  let calls = 0;
  const run = async () => { calls++; return '{}'; };
  const draft = { repo: 'maddec01/mux-server', kind: 'feature', title: 'Index files', description: '', labels: [] };
  for (const input of [
    null, { ...draft, repo: 'other/repo' }, { ...draft, kind: 'concept' },
    { ...draft, title: ' \n ' }, { ...draft, title: 12 }, { ...draft, description: {} },
    { ...draft, labels: ['app: music'] }, { ...draft, labels: ['area: server', 'anything'] },
  ]) {
    await assert.rejects(addProjectItem({ ...loadConfig(), number: 1 }, input, {}, run), /./);
  }
  assert.equal(calls, 0);
});

for (const failedStep of ['project membership', 'List status']) {
  test(`retry after failed ${failedStep} finishes the same issue without another creation`, async () => {
    const calls: string[][] = [];
    let fail = true;
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[1] === 'view') return JSON.stringify({ id: 'PVT_1' });
      if (args[1] === 'field-list') return JSON.stringify({ fields: [{ id: 'F', name: 'Status', options: [{ id: 'L', name: 'List' }] }] });
      if (args[0] === 'api') return JSON.stringify({ number: 82, html_url: 'https://github.com/maddec01/mux-server/issues/82', updated_at: '2026-10-21T10:00:00Z' });
      if (fail && args[1] === (failedStep === 'project membership' ? 'item-add' : 'item-edit')) throw new Error('GitHub unavailable');
      return JSON.stringify(args[1] === 'item-add' ? { id: 'PVTI_82' } : {});
    };
    const config = { ...loadConfig(), number: 1 };
    const draft = { repo: 'maddec01/mux-server', kind: 'improvement', title: 'Fast indexing', description: '', labels: [] };
    const progress: CreationProgress = {};
    const partial = await addProjectItem(config, draft, progress, run);
    assert.match(partial.error!, new RegExp(failedStep));
    assert.equal(partial.issueUrl, 'https://github.com/maddec01/mux-server/issues/82');
    fail = false;
    const result = await addProjectItem(config, draft, progress, run);
    assert.equal(result.item?.status, 'List');
    assert.deepEqual(result.item?.labels, ['improvement']);
    assert.equal(calls.filter((c) => c[0] === 'api').length, 1);
  });
}

test('an ambiguous GitHub creation response is never retried as a new issue', async () => {
  let creations = 0;
  const run = async (args: string[]) => {
    if (args[1] === 'view') return JSON.stringify({ id: 'P' });
    if (args[1] === 'field-list') return JSON.stringify({ fields: [{ id: 'F', name: 'Status', options: [{ id: 'L', name: 'List' }] }] });
    creations++;
    throw new Error('Connection lost');
  };
  const progress: CreationProgress = {};
  const draft = { repo: 'maddec01/mux-server', kind: 'bug', title: 'Lost response', description: '', labels: [] };
  const config = { ...loadConfig(), number: 1 };
  const first = await addProjectItem(config, draft, progress, run);
  assert.equal(first.uncertain, true);
  const retry = await addProjectItem(config, draft, progress, run);
  assert.equal(retry.uncertain, true);
  assert.equal(creations, 1);
});
