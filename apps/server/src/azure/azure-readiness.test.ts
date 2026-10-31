import { expect, test } from 'vite-plus/test';
import { readAzureReadiness } from './azure-readiness.ts';

const read = (policy = 'approved', vote = 10, state = 'succeeded', race = false) => {
  let heads = 0;
  return readAzureReadiness('org', 'project', 'repo', 1, async (args) => {
    const resource = args[args.indexOf('--resource') + 1];
    return JSON.stringify(resource === 'pullRequests' ? { lastMergeSourceCommit: { commitId: race && heads++ ? 'new' : 'old' }, repository: { project: { id: 'project-id' } } } : { value: resource === 'evaluations' ? [{ evaluationId: 'p', status: policy, configuration: { isEnabled: true, isBlocking: true } }] : resource === 'pullRequestReviewers' ? [{ id: 'r', vote, isRequired: true }] : [{ id: 1, state, context: { name: 'ci' }, iterationId: 2 }] });
  });
};
test('binds successful evidence to a revision', async () => expect(await read()).toMatchObject({ available: true, sourceRevision: 'old', blockers: [] }));
test.each(['queued', 'running', 'rejected', 'broken', 'unknown'])('blocks required policy %s', async (state) => expect(await read(state)).toMatchObject({ available: true, blockers: [`policy:p:${state}`] }));
test.each([-10, -5, 0, 99])('blocks unmet vote %s', async (vote) => expect(await read('approved', vote)).toMatchObject({ blockers: [`reviewer:r:${vote}`] }));
test('blocks pending statuses and retains iteration', async () => expect(await read('approved', 10, 'pending')).toMatchObject({ blockers: ['status:/ci:pending'], statuses: [{ iterationId: 2 }] }));
test('an unset native status blocks readiness while preserving the other evidence', async () => {
  const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => {
    const resource = args[args.indexOf('--resource') + 1];
    return JSON.stringify(resource === 'pullRequests'
      ? { lastMergeSourceCommit: { commitId: 'h' }, repository: { project: { id: 'p' } } }
      : { value: resource === 'pullRequestStatuses' ? [{ id: 1, context: { name: 'unset' } }, { id: 2, state: 'succeeded', context: { name: 'ci' } }] : [] });
  });
  expect(result).toMatchObject({ available: true, sourceRevision: 'h', blockers: ['status:/unset:notSet'], statuses: [{ id: 1, state: 'notSet' }, { id: 2, state: 'succeeded' }] });
});
test('invalidates revision races', async () => expect(await read('approved', 10, 'succeeded', true)).toMatchObject({ available: false }));
test.each(['{}', 'null', 'not json'])('refuses malformed evidence %s', async (value) => expect(await readAzureReadiness('o', 'p', 'r', 1, async () => value)).toMatchObject({ available: false }));
test('preserves permission failures', async () => expect(await readAzureReadiness('o', 'p', 'r', 1, async () => { throw new Error('403 forbidden'); })).toMatchObject({ available: false }));
test('accepts empty successful lists', async () => {
  const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => JSON.stringify(args[args.indexOf('--resource') + 1] === 'pullRequests' ? { lastMergeSourceCommit: { commitId: 'head' }, repository: { project: { id: 'p' } } } : { value: [] }));
  expect(result).toMatchObject({ available: true, blockers: [], policies: [], statuses: [], reviewers: [] });
});
test('retains optional failures without treating them as required', async () => {
  const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => {
    const resource = args[args.indexOf('--resource') + 1];
    return JSON.stringify(resource === 'pullRequests' ? { lastMergeSourceCommit: { commitId: 'h' }, repository: { project: { id: 'p' } } } : { value: resource === 'evaluations' ? [{ evaluationId: 'optional', status: 'rejected', configuration: { isBlocking: false, isEnabled: true } }] : [] });
  });
  expect(result).toMatchObject({ available: true, blockers: [], policies: [{ status: 'rejected' }] });
});
