// A fake az for the Azure DevOps item sources' tests, answering from a list of work items.

import { readFileSync, writeFileSync } from 'node:fs';

export interface WorkItem {
  id: number;
  type: string;
  state: string;
  title?: string;
  tags?: string;
  parent?: number;
  predecessors?: number[];
  closed?: string;
  /** Its area path; the team's own area when absent. */
  area?: string;
  /** The ids of the pull requests linked to it, each read from `pullRequests`. */
  prs?: number[];
}

/** The fake team's area path, which its area paths include with their children unless a test says otherwise. */
export const TEAM_AREA = 'Fabrikam Fiber\\Fabrikam Team';

/** Each process's states with their categories, as the work item type states endpoint lists them. */
export const STATES: Record<string, [string, string][]> = {
  'User Story': [['New', 'Proposed'], ['Active', 'InProgress'], ['Resolved', 'Resolved'], ['Closed', 'Completed'], ['Removed', 'Removed']],
  'Product Backlog Item': [['New', 'Proposed'], ['Approved', 'Proposed'], ['Committed', 'InProgress'], ['Done', 'Completed'], ['Removed', 'Removed']],
  'Issue': [['To Do', 'Proposed'], ['Doing', 'InProgress'], ['Done', 'Completed']],
  'Requirement': [['Proposed', 'Proposed'], ['Active', 'InProgress'], ['Resolved', 'Resolved'], ['Closed', 'Completed']],
  'Task': [['New', 'Proposed'], ['Active', 'InProgress'], ['Closed', 'Completed'], ['Removed', 'Removed']],
  'Epic': [['New', 'Proposed'], ['Active', 'InProgress'], ['Closed', 'Completed'], ['Removed', 'Removed']],
};

/**
 * A fake az for one team whose current sprint holds `sprint`'s ids and whose requirement backlog lists `backlog`'s,
 * reading `items` (listed or not), with `requirement` its requirement backlog level's type and `areas` its area paths.
 * `pullRequests` are the PRs az repos pr show prints, and `tags` the project's tags, which a tag PATCH renames. It records
 * each call, each work item patch, each work item created and each tag renamed, and `fail` throws for a call it matches.
 */
export function fakeAz({ items, sprint = items.map((i) => i.id), backlog = items.filter((i) => i.type !== 'Task').map((i) => i.id),
  requirement = 'User Story', areas = [{ value: TEAM_AREA, includeChildren: true }], iterations = [{ id: 'it-12', name: 'Sprint 12' }], pullRequests = [], tags = [], fail }: {
  items: WorkItem[];
  sprint?: number[];
  backlog?: number[];
  requirement?: string;
  areas?: { value: string; includeChildren: boolean }[];
  iterations?: { id: string; name: string }[];
  pullRequests?: FakePr[];
  tags?: string[];
  fail?: (args: string[]) => Error | undefined;
}) {
  const calls: string[][] = [];
  /** Each tag PATCH's tag and the new name its --in-file gives. */
  const tagRenames: { from: string; to: string }[] = [];
  /** Each workitemsbatch call's ids, read from its --in-file while the file exists. */
  const batches: number[][] = [];
  /** Each work item patch's id and operations, read from its --in-file while the file exists. */
  const patches: { id: number; ops: unknown[] }[] = [];
  /** Each work item created, with its id, type and operations; it joins the items the fake reads. */
  const created: { id: number; type: string; ops: { path: string; value: unknown }[] }[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]!;
  const route = (args: string[], key: string) => args.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);
  const raw = (i: WorkItem) => ({
    id: i.id, rev: 1, url: `https://dev.azure.com/contoso/_apis/wit/workItems/${i.id}`,
    fields: {
      'System.WorkItemType': i.type, 'System.State': i.state, 'System.AreaPath': i.area ?? TEAM_AREA, 'System.Title': i.title ?? `Item ${i.id}`, 'System.ChangedDate': '2026-10-21T08:00:00Z',
      ...i.tags && { 'System.Tags': i.tags }, ...i.parent && { 'System.Parent': i.parent }, ...i.closed && { 'Microsoft.VSTS.Common.ClosedDate': i.closed },
    },
    relations: [
      ...i.parent ? [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${i.parent}`, attributes: {} }] : [],
      ...items.filter((child) => child.parent === i.id)
        .map((child) => ({ rel: 'System.LinkTypes.Hierarchy-Forward', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${child.id}`, attributes: {} })),
      ...(i.predecessors ?? []).map((p) => ({ rel: 'System.LinkTypes.Dependency-Reverse', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${p}`, attributes: {} })),
      { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/x', attributes: {} },
      ...(i.prs ?? []).map((id) => ({ rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/p-guid%2Fr-guid%2F${id}`, attributes: { name: 'Pull Request' } })),
    ],
  });
  const run = async (args: string[]) => {
    calls.push(args);
    const failure = fail?.(args);
    if (failure) throw failure;
    const command = args.slice(0, 4).join(' ');
    if (command === 'boards iteration team list') return JSON.stringify(iterations.map((it) => ({ ...it, path: `Fabrikam Fiber\\${it.name}` })));
    if (command === 'boards iteration team list-work-items') {
      return JSON.stringify({ workItemRelations: sprint.map((id) => {
        const parent = byId.get(id)?.parent;
        return parent && sprint.includes(parent)
          ? { rel: 'System.LinkTypes.Hierarchy-Forward', source: { id: parent }, target: { id } }
          : { rel: null, source: null, target: { id } };
      }) });
    }
    if (command === 'repos pr show --id') {
      const pr = pullRequests.find((p) => p.pullRequestId === Number(flag(args, '--id')));
      if (!pr) throw new Error('az repos pr show failed: TF401180: The requested pull request was not found.');
      return JSON.stringify({ mergeStatus: 'succeeded', ...pr, repository: { name: 'lar-api', webUrl: REPO_URL } });
    }
    if (args[0] === 'devops' && args[1] === 'invoke') {
      const resource = `${flag(args, '--area')}/${flag(args, '--resource')}`;
      if (resource === 'work/backlogconfiguration') {
        return JSON.stringify({ requirementBacklog: { id: 'Microsoft.RequirementCategory', workItemTypes: [{ name: requirement }], defaultWorkItemType: { name: requirement } },
          taskBacklog: { id: 'Microsoft.TaskCategory', workItemTypes: [{ name: 'Task' }] } });
      }
      if (resource === 'work/workitems' && route(args, 'backlogId') === 'Microsoft.RequirementCategory') {
        return JSON.stringify({ workItems: backlog.map((id) => ({ rel: null, source: null, target: { id, url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}` } })) });
      }
      if (resource === 'work/teamfieldvalues') {
        return JSON.stringify({ field: { referenceName: 'System.AreaPath' }, defaultValue: areas[0]?.value, values: areas });
      }
      if (resource === 'wit/workitemsbatch') {
        const { ids } = JSON.parse(readFileSync(flag(args, '--in-file'), 'utf8')) as { ids: number[] };
        batches.push(ids);
        const found = ids.flatMap((id) => byId.has(id) ? [raw(byId.get(id)!)] : []);
        return JSON.stringify({ count: found.length, value: found });
      }
      if (resource === 'wit/workitems' && route(args, 'type')) {
        const type = route(args, 'type')!;
        const ops = JSON.parse(readFileSync(flag(args, '--in-file'), 'utf8')) as { path: string; value: unknown }[];
        const value = (path: string) => ops.find((op) => op.path === path)?.value as string | undefined;
        const id = Math.max(100, ...byId.keys()) + 1;
        created.push({ id, type, ops });
        byId.set(id, { id, type, state: STATES[type]![0]![0], title: value('/fields/System.Title'), tags: value('/fields/System.Tags') });
        return JSON.stringify(raw(byId.get(id)!));
      }
      if (resource === 'wit/workitems') {
        const id = Number(route(args, 'id'));
        if (!byId.has(id)) throw new Error(`fake az: no work item ${id}`);
        if (args.includes('--http-method')) patches.push({ id, ops: JSON.parse(readFileSync(flag(args, '--in-file'), 'utf8')) as unknown[] });
        return JSON.stringify(raw(byId.get(id)!));
      }
      if (resource === 'wit/tags' && args.includes('--http-method')) {
        const from = route(args, 'tagIdOrName')!;
        const { name: to } = JSON.parse(readFileSync(flag(args, '--in-file'), 'utf8')) as { name: string };
        const at = tags.findIndex((t) => t.toLowerCase() === from.toLowerCase());
        if (at < 0) throw new Error(`az devops invoke failed: TF400516: The tag ${from} does not exist.`);
        tagRenames.push({ from, to });
        tags[at] = to;
        return JSON.stringify({ id: `tag-${at}`, name: to });
      }
      if (resource === 'wit/tags') return JSON.stringify({ count: tags.length, value: tags.map((name, at) => ({ id: `tag-${at}`, name, active: true })) });
      if (resource === 'wit/workitemtypestates') {
        const states = STATES[route(args, 'type')!]!;
        return JSON.stringify({ count: states.length, value: states.map(([name, category]) => ({ name, color: '000000', category })) });
      }
    }
    throw new Error(`fake az: unexpected ${args.join(' ')}`);
  };
  return { calls, batches, patches, created, tags, tagRenames, run };
}

/** A pull request on the fake repository, as az repos pr show prints it. */
export interface FakePr {
  pullRequestId: number;
  status: 'active' | 'completed' | 'abandoned';
  isDraft?: boolean;
  mergeStatus?: string;
  sourceRefName: string;
  description?: string;
  closedDate?: string;
}

/** One change of a push to the fake repository: its type, path and, unless it deletes, its text. */
interface FakeChange {
  changeType: string;
  path: string;
  content?: string;
}

/** The fake repository's web URL, as az prints it for contoso/Fabrikam%20Fiber/lar-api. */
export const REPO_URL = 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar-api';

/**
 * A fake az for one Azure Repos repository whose default branch, `defaultBranch` or main, is at abc123 and holds `files`,
 * with `branches` besides it, by name and head, whose files a read gets from `branchFiles`, and `prs`, in a project
 * whose tags are `tags`; `canPush` is whether az's login may push to it. Each commit's
 * tree lists `files`, in part when `partialTree`. Pushes and PRs change it, and it records each call. A push whose old head is out of date fails, and `fail`
 * throws for a call it matches.
 */
export function fakeAzRepos({ files = {}, defaultBranch = 'main', branches = {}, branchFiles = {}, prs = [], tags = [], canPush = true, partialTree = false, fail }: {
  files?: Record<string, string>;
  defaultBranch?: string;
  branches?: Record<string, string>;
  branchFiles?: Record<string, Record<string, string>>;
  tags?: string[];
  prs?: FakePr[];
  canPush?: boolean;
  partialTree?: boolean;
  fail?: (args: string[]) => Error | undefined;
} = {}) {
  const calls: string[][] = [];
  /** Each push's ref, its commit's parents and message, and each change's type, path and text, read from its --in-file while the file exists. */
  const pushes: { ref: string; oldObjectId: string; parents: string[]; comment: string; changes: FakeChange[] }[] = [];
  /** Each comment thread posted on a PR, by the PR's id. */
  const comments: { id: number; content: string }[] = [];
  const heads = new Map(Object.entries({ [defaultBranch]: 'abc123', ...branches }));
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]!;
  const route = (args: string[], key: string) => args.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);
  const show = (pr: FakePr) => JSON.stringify({ mergeStatus: 'succeeded', ...pr, repository: { name: 'lar-api', webUrl: REPO_URL } });
  const byId = (args: string[]) => {
    const pr = prs.find((p) => p.pullRequestId === Number(flag(args, '--id')));
    if (!pr) throw new Error('az repos pr show failed: TF401180: The requested pull request was not found.');
    return pr;
  };
  const run = async (args: string[]) => {
    calls.push(args);
    const failure = fail?.(args);
    if (failure) throw failure;
    const command = args.slice(0, 3).join(' ');
    if (args[0] === 'devops' && args[1] === 'invoke') {
      const resource = `${flag(args, '--area')}/${flag(args, '--resource')}`;
      if (resource === 'git/items') {
        const path = route(args, 'path')!;
        const version = route(args, 'versionDescriptor.version');
        const read = version === undefined || version === defaultBranch ? files : branchFiles[version] ?? {};
        if (!(path in read)) throw new Error(`az devops invoke failed: TF401174: The item ${path} could not be found in the repository.`);
        return JSON.stringify({ path, content: read[path] });
      }
      if (resource === 'git/commits') return JSON.stringify({ commitId: route(args, 'commitId'), treeId: `tree-${route(args, 'commitId')}` });
      if (resource === 'git/trees') {
        // A recursive tree lists each folder too, and each entry's path from the tree's root.
        const folders = [...new Set(Object.keys(files).flatMap((path) => path.split('/').slice(1, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))];
        return JSON.stringify({ objectId: route(args, 'sha1'), continuation_token: partialTree ? 'more' : null, treeEntries: [
          ...folders.map((path) => ({ relativePath: path, mode: '40000', gitObjectType: 'tree', objectId: `tree:${path}` })),
          ...Object.keys(files).map((path) => ({ relativePath: path.slice(1), mode: '100644', gitObjectType: 'blob', objectId: `blob:${path}` })),
        ] });
      }
      if (resource === 'git/blobs') {
        writeFileSync(flag(args, '--out-file'), files[route(args, 'sha1')!.replace(/^blob:/, '')]!);
        return '';
      }
      if (resource === 'git/pushes') {
        const body = JSON.parse(readFileSync(flag(args, '--in-file'), 'utf8')) as {
          refUpdates: { name: string; oldObjectId: string }[];
          commits: { comment: string; parents: string[]; changes: { changeType: string; item: { path: string }; newContent?: { content: string; contentType: string } }[] }[];
        };
        const [{ name, oldObjectId }] = body.refUpdates as [{ name: string; oldObjectId: string }];
        const [commit] = body.commits as [typeof body.commits[number]];
        // A push names the ref's head as it was, or 40 zeros for a new ref, and Azure refuses it when that is not so.
        const branch = name.replace('refs/heads/', '');
        if (oldObjectId !== (heads.get(branch) ?? '0'.repeat(40))) throw new Error(`az devops invoke failed: TF401028: The reference '${name}' has already been updated by another client.`);
        pushes.push({ ref: name, oldObjectId, parents: commit.parents, comment: commit.comment, changes: commit.changes.map((c) => ({ changeType: c.changeType, path: c.item.path,
          ...c.newContent && { content: Buffer.from(c.newContent.content, c.newContent.contentType === 'base64encoded' ? 'base64' : 'utf8').toString() } })) });
        heads.set(branch, `pushed${pushes.length}`);
        return JSON.stringify({ pushId: pushes.length });
      }
      if (resource === 'wit/tags' && !args.includes('--http-method')) {
        return JSON.stringify({ count: tags.length, value: tags.map((name, at) => ({ id: `tag-${at}`, name, active: true })) });
      }
      if (resource === 'security/permissions') {
        // The Git Repositories namespace's GenericContribute bit, on the repository's token, for the caller.
        const asked = [route(args, 'securityNamespaceId'), route(args, 'permissions'), route(args, 'tokens')];
        if (asked.join(' ') !== '2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87 4 repoV2/project-1/repo-1') throw new Error(`fake az: unexpected permission ${asked.join(' ')}`);
        return JSON.stringify({ count: 1, value: [canPush] });
      }
      if (resource === 'git/pullRequestThreads') {
        const body = JSON.parse(readFileSync(flag(args, '--in-file'), 'utf8')) as { comments: { content: string }[] };
        comments.push({ id: Number(route(args, 'pullRequestId')), content: body.comments[0]!.content });
        return '{}';
      }
    }
    if (command === 'repos show --repository') {
      return JSON.stringify({ id: 'repo-1', name: 'lar-api', defaultBranch: `refs/heads/${defaultBranch}`, webUrl: REPO_URL, project: { id: 'project-1', name: 'Fabrikam Fiber' } });
    }
    if (command === 'repos ref list') {
      // --filter matches the start of each name after refs/.
      const filter = flag(args, '--filter');
      return JSON.stringify([...heads].filter(([name]) => `heads/${name}`.startsWith(filter)).map(([name, objectId]) => ({ name: `refs/heads/${name}`, objectId })));
    }
    if (command === 'repos pr list') {
      const source = `refs/heads/${flag(args, '--source-branch')}`;
      return JSON.stringify(prs.filter((p) => p.sourceRefName === source && p.status === 'active').map((p) => JSON.parse(show(p)) as unknown));
    }
    if (command === 'repos pr create') {
      const pr: FakePr = { pullRequestId: 100 + prs.length, status: 'active', sourceRefName: `refs/heads/${flag(args, '--source-branch')}` };
      prs.push(pr);
      return show(pr);
    }
    if (command === 'repos pr show') return show(byId(args));
    if (command === 'repos pr update') {
      const pr = byId(args);
      if (args.includes('--status')) pr.status = flag(args, '--status') as FakePr['status'];
      // The board passes --description=<text> joined, so a description starting with - is no option.
      const description = args.find((a) => a.startsWith('--description='));
      if (description !== undefined) pr.description = description.slice('--description='.length);
      return show(pr);
    }
    throw new Error(`fake az: unexpected ${args.join(' ')}`);
  };
  return { calls, pushes, comments, heads, prs, run };
}
