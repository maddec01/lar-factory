// Reads the lar project through the local `gh` CLI (`gh api graphql`).

import { DONE_WINDOW_MS, buildSubIssueSearch, isDraft, normalizeItems, projectBuilds, rawDossiers, refKey, sliceLabelSearch, validateDraft } from '@lar-factory/shared';
import type { CreationProgress, CreationResult, Item, ItemDraft, RawItem, Searched, Status } from '@lar-factory/shared';
import type { BoardConfig } from '../config/config.ts';
import type { ItemsRead } from '../items/item-source.ts';
import { runTool } from '../tools/run-tool.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
/** Checks read per PR for the start time; the counts always cover all of them. */
const CHECK_SLICE = 20;
/** Blocked-by issues read per issue; the count covers every open one. */
const BLOCKER_LIMIT = 20;
/** A build's slices read per build; more than this is a build to split. */
const SLICE_LIMIT = 50;
/** Issues read per search page; a search pages up to GitHub's 1000 results. */
const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 10;

/** A PR's checks: counts over all of them, and the first CHECK_SLICE for the start time. */
const CHECKS = `statusCheckRollup {
    contexts(first: ${CHECK_SLICE}) {
      checkRunCountsByState { state count }
      statusContextCountsByState { state count }
      nodes { ... on CheckRun { status startedAt checkSuite { createdAt } } ... on StatusContext { state createdAt } }
    }
  }`;

/** The fields the board reads of an issue, on the Project or in a repository. */
const ISSUE_FIELDS = `id number title url state stateReason closedAt updatedAt
  repository { nameWithOwner }
  labels(first: 20) { nodes { name } }
  parent { number title url state repository { nameWithOwner } }
  subIssuesSummary { total completed }
  subIssues(first: ${SLICE_LIMIT}) { nodes { number title url state stateReason repository { nameWithOwner } } }
  blockedBy(first: ${BLOCKER_LIMIT}) { nodes { number state repository { nameWithOwner } } }
  closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
    nodes {
      number url state isDraft body mergedAt mergeStateStatus
      ${CHECKS}
    }
  }`;

export const ITEMS_QUERY = `query($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      title
      items(first: ${PAGE_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          updatedAt
          status: fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          content {
            __typename
            ... on DraftIssue { id title updatedAt }
            ... on Issue { ${ISSUE_FIELDS} }
            ... on PullRequest {
              id number title url state closedAt updatedAt isDraft mergeStateStatus
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              ${CHECKS}
            }
          }
        }
      }
    }
  }
}`;

/** One page of a repository's issues in the given states, updated since `since` when it is set. */
const REPO_ISSUES_QUERY = `query($owner: String!, $name: String!, $states: [IssueState!], $since: DateTime, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: ${PAGE_SIZE}, after: $after, states: $states, filterBy: { since: $since }) {
      pageInfo { hasNextPage endCursor }
      nodes { __typename ${ISSUE_FIELDS} }
    }
  }
}`;

/**
 * One page of an issue search, for the sub-issue labels the board needs: `build`,
 * `active` and `blocked`. Labels on every sub-issue in ITEMS_QUERY cost 60 points a page, not 10; a
 * search page costs 1.
 */
export const ISSUE_SEARCH_QUERY = `query($q: String!, $after: String) {
  search(type: ISSUE, first: ${SEARCH_PAGE_SIZE}, after: $after, query: $q) { pageInfo { hasNextPage endCursor } nodes { ... on Issue { number repository { nameWithOwner } } } }
}`;

/**
 * Dossiers' bodies, by issue node id, up to PAGE_SIZE ids a call. Only the body of a concept
 * or of an item with sub-issues on the board is read, for its map, so the board query skips
 * every other issue's body.
 */
export const DOSSIER_BODIES_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Issue { id body } }
}`;

const FIND_PROJECT_QUERY = `query($owner: String!, $title: String!) {
  user(login: $owner) { projectsV2(first: 50, query: $title) { nodes { number title } } }
}`;

// ---------- raw GraphQL shapes ----------

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface RawIssueSearch {
  data: { search: { pageInfo: PageInfo; nodes: { number?: number; repository?: { nameWithOwner: string } }[] } };
}

interface RawBodies {
  data: { nodes: ({ id?: string; body?: string } | null)[] };
}

interface RawRepoIssuesPage {
  data: { repository: { issues: { pageInfo: PageInfo; nodes: NonNullable<RawItem['content']>[] } } | null };
}

interface RawItemsPage {
  data: {
    user: {
      projectV2: {
        title: string;
        items: { pageInfo: PageInfo; nodes: RawItem[] };
      } | null;
    } | null;
  };
}

// ---------- gh ----------

async function gh(args: string[]): Promise<string> {
  const command = toolCommand('gh');
  if (!command) throw new Error(`${missingTool('gh')}. Install it with \`brew install gh\` or set GH_PATH.`);
  const result = await runTool(command.file, args, { env: command.env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.code !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${result.detail}`);
  return result.stdout;
}

async function graphql<T>(query: string, vars: Record<string, string | number | string[] | null>): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(vars)) {
    if (value === null) continue;
    if (Array.isArray(value)) args.push(...value.flatMap((v) => ['-f', `${key}[]=${v}`]));
    else args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  }
  return JSON.parse(await gh(args)) as T;
}

export async function findProjectNumber(owner: string, title: string): Promise<number> {
  const res = await graphql<{
    data: { user: { projectsV2: { nodes: { number: number; title: string }[] } } | null };
  }>(FIND_PROJECT_QUERY, { owner, title });
  const match = res.data.user?.projectsV2.nodes.find((p) => p.title === title);
  if (!match) throw new Error(`No project titled "${title}" for user ${owner}`);
  return match.number;
}

const projectNumber = (config: BoardConfig) => config.number ?? findProjectNumber(config.owner, config.title);

/** Reads up to `maxPages` pages, each after the cursor the one before ended at; throws `tooMany` when there are more. */
async function readPages(maxPages: number, tooMany: string, readPage: (after: string | null) => Promise<PageInfo>): Promise<void> {
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const pageInfo = await readPage(after);
    if (!pageInfo.hasNextPage) return;
    after = pageInfo.endCursor;
  }
  throw new Error(tooMany);
}

/** The `repo#number` keys of the issues a search finds; none for no search. */
async function searchIssues(q: string | null): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!q) return keys;
  await readPages(MAX_SEARCH_PAGES, `Issue search "${q}" has more than ${SEARCH_PAGE_SIZE * MAX_SEARCH_PAGES} results; stopped paging`, async (after) => {
    const { search } = (await graphql<RawIssueSearch>(ISSUE_SEARCH_QUERY, { q, after })).data;
    for (const n of search.nodes) if (n.repository && n.number) keys.add(refKey(n.repository.nameWithOwner, n.number));
    return search.pageInfo;
  });
  return keys;
}

/** Runs the issue searches; the slice label searches need the builds found, to know which sub-issues are slices. A project item's own labels decide whether it's a build. */
async function searchLabels(raws: RawItem[]): Promise<Searched> {
  const builds = new Set([...projectBuilds(raws), ...await searchIssues(buildSubIssueSearch(raws))]);
  const [active, blocked] = await Promise.all([
    searchIssues(sliceLabelSearch('active', raws, builds)),
    searchIssues(sliceLabelSearch('blocked', raws, builds)),
  ]);
  return { builds, active, blocked };
}

/** Puts each dossier's body on its raw item, for its map. */
async function readDossierBodies(raws: RawItem[], searched: Searched): Promise<void> {
  const dossiers = new Map(rawDossiers(raws, searched).flatMap((raw) => (raw.content ? [[raw.content.id, raw.content]] : [])));
  const ids = [...dossiers.keys()];
  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    const { nodes } = (await graphql<RawBodies>(DOSSIER_BODIES_QUERY, { ids: ids.slice(start, start + PAGE_SIZE) })).data;
    for (const node of nodes) {
      const content = node?.id ? dossiers.get(node.id) : undefined;
      if (node && content) content.body = node.body ?? '';
    }
  }
}

/** A Project read: its items, and the Project item id of each by its Item.id, for the Project adapter's writes. */
export interface ProjectRead extends ItemsRead {
  projectItemIds: Map<string, string>;
}

export async function fetchProject(owner: string, number: number): Promise<ProjectRead> {
  const raws: RawItem[] = [];
  let title = '';
  await readPages(MAX_PAGES, `Project has more than ${PAGE_SIZE * MAX_PAGES} items; stopped paging`, async (after) => {
    const project = (await graphql<RawItemsPage>(ITEMS_QUERY, { owner, number, after })).data.user?.projectV2;
    if (!project) throw new Error(`Project ${owner}/${number} not found`);
    title = project.title;
    raws.push(...project.items.nodes);
    return project.items.pageInfo;
  });
  const projectItemIds = new Map(raws.flatMap((raw) => (raw.content ? [[raw.content.id, raw.id]] : [])));
  return { title, items: await boardItems(raws), projectItemIds };
}

/** The board's items from raw items, once all are read, without slices and with each dossier's map. */
async function boardItems(raws: RawItem[]): Promise<Item[]> {
  // A slice and its build can sit on different pages, so slices are dropped once all are read. The searches
  // decide which sub-issues are slices, so they run before the dossiers, items with sub-issues on the board, are known.
  const searched = await searchLabels(raws);
  await readDossierBodies(raws, searched);
  return normalizeItems(raws, searched);
}

/**
 * A repository's open issues as List, and those closed in the last DONE_WINDOW_MS as Done, without slices. Until
 * status labels come, every open issue is List.
 */
export async function fetchRepoIssues(repo: string, now = Date.now()): Promise<Item[]> {
  const [owner, name] = repo.split('/');
  const since = new Date(now - DONE_WINDOW_MS).toISOString();
  const read = async (state: 'OPEN' | 'CLOSED') => {
    const issues: NonNullable<RawItem['content']>[] = [];
    await readPages(MAX_PAGES, `${repo} has more than ${PAGE_SIZE * MAX_PAGES} ${state.toLowerCase()} issues to show; stopped paging`, async (after) => {
      const page = (await graphql<RawRepoIssuesPage>(REPO_ISSUES_QUERY,
        { owner: owner!, name: name!, states: [state], since: state === 'CLOSED' ? since : null, after })).data.repository?.issues;
      if (!page) throw new Error(`Repository ${repo} not found`);
      issues.push(...page.nodes);
      return page.pageInfo;
    });
    return issues;
  };
  const [open, closed] = await Promise.all([read('OPEN'), read('CLOSED')]);
  // An issue updated since the window began may have closed before it.
  const recent = closed.filter((issue) => issue.closedAt && Date.parse(issue.closedAt) >= now - DONE_WINDOW_MS);
  // Not on a Project, so an issue's own node id stands in for the Project item id normalizeItems never shows.
  const raws = [...open, ...recent].map((content): RawItem => ({ id: content.id, updatedAt: content.updatedAt,
    status: { name: content.state === 'CLOSED' ? 'Done' : 'List' }, content }));
  return boardItems(raws);
}

/** An error's message, for a write's error text. */
const message = (err: unknown) => (err instanceof Error ? err.message : 'GitHub request failed.');

/** Looks up the project's Status option once and returns a writer for it. */
async function statusWriter(config: BoardConfig, name: Status, run: (args: string[]) => Promise<string>) {
  const number = await projectNumber(config);
  const project = JSON.parse(await run(['project', 'view', String(number), '--owner', config.owner, '--format', 'json'])) as { id: string };
  const fields = JSON.parse(await run(['project', 'field-list', String(number), '--owner', config.owner, '--format', 'json'])) as {
    fields: { id: string; name: string; options?: { id: string; name: string }[] }[];
  };
  const status = fields.fields.find((f) => f.name === 'Status');
  const option = status?.options?.find((o) => o.name === name);
  if (!project.id || !status || !option) throw new Error(`The project has no ${name} status.`);
  const setStatus = (itemId: string) => run(['project', 'item-edit', '--project-id', project.id, '--id', itemId,
    '--field-id', status.id, '--single-select-option-id', option.id]);
  return { number, setStatus };
}

/** Sets an existing project item's Status; returns the error, or null when GitHub accepted it. */
export async function setItemStatus(
  config: BoardConfig,
  itemId: string,
  name: Status,
  run: (args: string[]) => Promise<string> = gh,
): Promise<string | null> {
  try {
    await (await statusWriter(config, name, run)).setStatus(itemId);
    return null;
  } catch (err) {
    return `Could not set ${name}. ${message(err)}`;
  }
}

/** Adds an issue to the project if it isn't there, as status.sh does, then sets its Status; returns the error, or null. */
export async function setIssueStatus(
  config: BoardConfig,
  url: string,
  name: Status,
  run: (args: string[]) => Promise<string> = gh,
): Promise<string | null> {
  try {
    const { number, setStatus } = await statusWriter(config, name, run);
    const member = JSON.parse(await run(['project', 'item-add', String(number), '--owner', config.owner, '--url', url, '--format', 'json'])) as { id?: string };
    if (!member.id) throw new Error('GitHub did not return a project item.');
    await setStatus(member.id);
    return null;
  } catch (err) {
    return `Could not set ${name}. ${message(err)}`;
  }
}

/** Adds a label to an issue; returns the error, or null when GitHub accepted it. */
export async function addIssueLabel(repo: string, number: number, label: string,
  run: (args: string[]) => Promise<string> = gh): Promise<string | null> {
  try {
    await run(['issue', 'edit', String(number), '-R', repo, '--add-label', label]);
    return null;
  } catch (err) {
    return `Could not add the ${label} label. ${message(err)}`;
  }
}

/** An issue's labels as GitHub has them now. */
export async function issueLabels(repo: string, number: number, run: (args: string[]) => Promise<string> = gh): Promise<string[]> {
  const issue = JSON.parse(await run(['api', `repos/${repo}/issues/${number}`])) as { labels?: { name: string }[] };
  return (issue.labels ?? []).map((l) => l.name);
}

/** A PR's REST path, `repos/<owner>/<repo>/pulls/<n>`, from its URL. */
function pullPath(url: string): string {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/.exec(url);
  if (!match) throw new Error(`Not a pull request URL: ${url}`);
  return `repos/${match[1]}/pulls/${match[2]}`;
}

/** A PR's description as it is now, by the PR's URL; empty when it has none. */
export async function readPrBody(url: string, run: (args: string[]) => Promise<string> = gh): Promise<string> {
  const pr = JSON.parse(await run(['api', pullPath(url)])) as { body?: string | null };
  return pr.body ?? '';
}

/** Replaces a PR's description, by the PR's URL. */
export async function editPrBody(url: string, body: string, run: (args: string[]) => Promise<string> = gh): Promise<void> {
  // -f sends the body as a string as is; -F would read a body starting with @ as a file.
  await run(['api', '--method', 'PATCH', pullPath(url), '-f', `body=${body}`]);
}

/** Deletes an issue for good, which needs admin rights on its repository; returns the error, or null when GitHub accepted it. */
export async function deleteIssue(item: Item, run: (args: string[]) => Promise<string> = gh): Promise<string | null> {
  try {
    await run(['issue', 'delete', String(item.number), '-R', item.repo!, '--yes']);
    return null;
  } catch (err) {
    return `Could not delete #${item.number}. ${message(err)}`;
  }
}

/** Deletes an issue for good, or removes a draft from the project by its Project item id; returns the error, or null when GitHub accepted it. */
export async function abandonItem(
  config: BoardConfig,
  item: Item,
  projectItemId: string | undefined,
  run: (args: string[]) => Promise<string> = gh,
): Promise<string | null> {
  if (!isDraft(item)) return deleteIssue(item, run);
  try {
    if (!projectItemId) throw new Error('The board has not read this draft from the project.');
    const number = await projectNumber(config);
    await run(['project', 'item-delete', String(number), '--owner', config.owner, '--id', projectItemId]);
    return null;
  } catch (err) {
    return `Could not remove draft ${item.title}. ${message(err)}`;
  }
}

/**
 * How an item source takes in the issue Add item creates: `setup` runs before the issue exists, and returns the steps
 * that follow its creation, each named for the error.
 */
type IssueHome = () => Promise<{ step: string; run: (issue: NonNullable<CreationProgress['issue']>) => Promise<void> }[]>;

/** Add item's progress in the Project: the shared progress, and the new issue's Project item id once it has one. */
export type ProjectCreationProgress = CreationProgress & { projectItemId?: string };

/** Creates an issue, adds it to the configured project and explicitly assigns List. */
export async function addProjectItem(
  config: BoardConfig,
  input: unknown,
  progress: ProjectCreationProgress,
  run: (args: string[]) => Promise<string> = gh,
): Promise<CreationResult> {
  const draft = validateDraft(input, config.repos);
  return createIssue(draft, progress, run, async () => {
    const { number, setStatus } = await statusWriter(config, 'List', run);
    return [
      { step: 'project membership', run: async (issue) => {
        if (progress.projectItemId) return;
        // GitHub item-add reuses membership when the issue is already on this project.
        const member = JSON.parse(await run(['project', 'item-add', String(number), '--owner', config.owner,
          '--url', issue.html_url, '--format', 'json'])) as { id: string };
        if (!member.id) throw new Error('GitHub did not return a project item.');
        progress.projectItemId = member.id;
      } },
      { step: 'List status', run: () => setStatus(progress.projectItemId!).then(() => undefined) },
    ];
  });
}

/**
 * Creates the issue a draft describes, and nothing else, resuming from `progress` after a failed try; `home` adds the
 * steps an item source needs around it. The issue shows as List.
 */
export async function createIssue(
  draft: ItemDraft,
  progress: CreationProgress,
  run: (args: string[]) => Promise<string> = gh,
  home: IssueHome = async () => [],
): Promise<CreationResult> {
  let step = 'project setup';
  const uncertain = (): CreationResult => ({ item: null, issueUrl: null, uncertain: true,
    error: 'Issue creation could not be confirmed. Check the repository issues before starting a new item; this submission will not create another issue.' });
  if (progress.creationUncertain) return uncertain();
  try {
    if (progress.item) return { item: progress.item, issueUrl: progress.item.url, error: null };
    const after = await home();
    const labels = [draft.kind, ...draft.labels];
    step = 'issue creation';
    if (!progress.issue) {
      // A CLI timeout can happen after GitHub accepted the issue. Never blindly recreate it.
      progress.creationUncertain = true;
      const issue = JSON.parse(await run(['api', '--method', 'POST', `repos/${draft.repo}/issues`,
        '-f', `title=${draft.title}`, '-f', `body=${draft.description}`,
        ...labels.flatMap((label) => ['-f', `labels[]=${label}`])])) as NonNullable<CreationProgress['issue']>;
      if (!Number.isSafeInteger(issue.number) || !issue.node_id || issue.html_url !== `https://github.com/${draft.repo}/issues/${issue.number}`) {
        throw new Error('GitHub did not return an issue identity.');
      }
      progress.issue = issue;
      progress.creationUncertain = false;
    }
    const issue = progress.issue;
    for (const next of after) {
      step = next.step;
      await next.run(issue);
    }
    progress.item = {
      id: issue.node_id, status: 'List', content: 'ticket', number: issue.number,
      title: draft.title, url: issue.html_url, repo: draft.repo, labels, state: 'open', closedAs: null,
      parent: null, subIssues: { total: 0, completed: 0 }, blockers: [],
      updatedAt: issue.updated_at, closedAt: null, linkedPrs: [], slices: [],
    };
    return { item: progress.item, issueUrl: issue.html_url, error: null };
  } catch (err) {
    const detail = message(err);
    // A definite client rejection did not create an issue and can be corrected/retried.
    if (step === 'issue creation' && /HTTP (?:400|401|403|404|410|422)\b/.test(detail)) progress.creationUncertain = false;
    if (progress.creationUncertain) return uncertain();
    return { item: null, issueUrl: progress.issue?.html_url ?? null,
      error: `Could not finish ${step}. ${detail}` };
  }
}
