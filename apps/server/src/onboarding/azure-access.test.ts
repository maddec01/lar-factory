import { expect, test } from 'vite-plus/test';
import { azureAccess } from './azure-access.ts';

test('Azure checks branch, PR and work-item permissions independently using read-only calls', async () => {
  const calls: string[][] = [];
  const access = await azureAccess('example/Team%20Project/app', async (args) => {
    calls.push(args);
    if (args[0] === 'repos') return JSON.stringify({ id: 'repository', project: { id: 'project' } });
    const url = new URL(args[args.indexOf('--url') + 1]!);
    if (url.pathname.endsWith('/securitynamespaces')) return JSON.stringify({ value: [
      { namespaceId: 'git', name: 'Git Repositories', actions: [{ name: 'GenericContribute', bit: 4 }, { name: 'CreateBranch', bit: 16 }, { name: 'PullRequestContribute', bit: 16384 }] },
      { namespaceId: 'css', name: 'CSS', actions: [{ name: 'WORK_ITEM_WRITE', bit: 32 }] },
    ] });
    if (url.pathname.endsWith('/classificationnodes/areas')) return JSON.stringify({ identifier: 'root-area' });
    expect(url.searchParams.get('tokens')).toBe(url.pathname.includes('/git/') ? 'repoV2/project/repository' : 'vstfs:///Classification/Node/root-area');
    return JSON.stringify({ value: [!url.pathname.endsWith('/git/16384')] });
  });
  expect(access).toMatchObject({ 'push-branch': 'allowed', 'open-pr': 'refused', 'publish-ticket': 'allowed', 'edit-ticket': 'allowed', 'comment-ticket': 'allowed' });
  expect(calls.every((args) => args[0] === 'repos' ? args[1] === 'show' : args[args.indexOf('--method') + 1] === 'get')).toBe(true);
});

/** Azure's answers for a login whose Tagging permissions are `tagging`, by action; an action left out is not in the namespace. */
const taggingAccess = (tagging: Record<string, boolean>) => {
  const bits: Record<string, number> = { Create: 2, Update: 4, Delete: 8 };
  return azureAccess('example/project/app', async (args) => {
    if (args[0] === 'repos') return JSON.stringify({ id: 'repository', project: { id: 'project-id' } });
    expect(args[args.indexOf('--method') + 1]).toBe('get');
    const url = new URL(args[args.indexOf('--url') + 1]!);
    if (url.pathname.endsWith('/securitynamespaces')) return JSON.stringify({ value: [{ namespaceId: 'tagging', name: 'Tagging', actions: Object.keys(tagging).map((name) => ({ name, bit: bits[name] })) }] });
    if (url.pathname.endsWith('/classificationnodes/areas')) throw new Error('Not permitted');
    expect(url.searchParams.get('tokens')).toBe('/project-id');
    const action = Object.keys(bits).find((name) => url.pathname.endsWith(`/tagging/${bits[name]}`))!;
    return JSON.stringify({ value: [tagging[action]] });
  });
};

test('Azure allows label management only when the project allows creating, updating and deleting tags', async () => {
  expect(await taggingAccess({ Create: true, Update: true, Delete: true })).toEqual({ 'manage-labels': 'allowed' });
  expect(await taggingAccess({ Create: false, Update: true, Delete: true })).toEqual({ 'manage-labels': 'refused' });
  expect(await taggingAccess({ Create: true, Update: true, Delete: false })).toEqual({ 'manage-labels': 'refused' });
});

test('an Azure login with no evidence for a tag permission leaves label management unchecked', async () => {
  expect(await taggingAccess({ Create: true, Update: true })).toEqual({});
});

test('missing or unreadable permission evidence stays unchecked', async () => {
  const access = await azureAccess('example/project/app', async (args) => {
    if (args[0] === 'repos') return JSON.stringify({ id: 'repository', project: { id: 'project' } });
    if (args.some((arg) => arg.includes('/securitynamespaces?'))) return JSON.stringify({ value: [] });
    throw new Error('Not permitted');
  });
  expect(access).toEqual({});
});
