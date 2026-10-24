// Reads the Mux project through the local `gh` CLI (`gh api graphql`).

import { execFile } from 'node:child_process';
import { buildSubIssueSearch, normalizeItems, projectBuilds, refKey, sliceLabelSearch, validateDraft } from '@mux-factory/shared';
import type { CreationProgress, CreationResult, Item, RawItem, Searched, Status } from '@mux-factory/shared';
import type { BoardConfig } from '../config/config.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
/** Checks read per PR for the start time; the counts always cover all of them. */
const CHECK_SLICE = 20;
/** A build's slices read per build; more than this is a build to split. */
const SLICE_LIMIT = 50;
/** Issues read per search page; a search pages up to GitHub's 1000 results. */
const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 10;

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
            ... on DraftIssue { title updatedAt }
            ... on Issue {
              number title url state closedAt updatedAt
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              parent { number title url state repository { nameWithOwner } }
              subIssuesSummary { total completed }
              subIssues(first: ${SLICE_LIMIT}) { nodes { number title url state stateReason repository { nameWithOwner } } }
              issueDependenciesSummary { blockedBy }
              closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
                nodes {
                  number url state isDraft body mergedAt
                  statusCheckRollup {
                    contexts(first: ${CHECK_SLICE}) {
                      checkRunCountsByState { state count }
                      statusContextCountsByState { state count }
                      nodes { ... on CheckRun { status startedAt checkSuite { createdAt } } ... on StatusContext { state createdAt } }
                    }
                  }
                }
              }
            }
            ... on PullRequest {
              number title url state closedAt updatedAt isDraft
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
            }
          }
        }
      }
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

const FIND_PROJECT_QUERY = `query($owner: String!, $title: String!) {
  user(login: $owner) { projectsV2(first: 50, query: $title) { nodes { number title } } }
}`;

// ---------- raw GraphQL shapes ----------

export interface RawIssueSearch {
  data: { search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { number?: number; repository?: { nameWithOwner: string } }[] } };
}

export interface RawItemsPage {
  data: {
    user: {
      projectV2: {
        title: string;
        items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItem[] };
      } | null;
    } | null;
  };
}

// ---------- gh ----------

function gh(args: string[]): Promise<string> {
  const command = toolCommand('gh');
  if (!command) return Promise.reject(new Error(`${missingTool('gh')}. Install it with \`brew install gh\` or set GH_PATH.`));
  return new Promise((resolve, reject) => {
    execFile(command.file, args, { env: command.env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || stdout || err.message).trim().split('\n').slice(0, 4).join('\n');
        reject(new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${detail}`));
      } else resolve(stdout);
    });
  });
}

async function graphql<T>(query: string, vars: Record<string, string | number | null>): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(vars)) {
    if (value === null) continue;
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
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

/** The `repo#number` keys of the issues a search finds; none for no search. */
async function searchIssues(q: string | null): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!q) return keys;
  let after: string | null = null;
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const { search }: RawIssueSearch['data'] = (await graphql<RawIssueSearch>(ISSUE_SEARCH_QUERY, { q, after })).data;
    for (const n of search.nodes) if (n.repository && n.number) keys.add(refKey(n.repository.nameWithOwner, n.number));
    if (!search.pageInfo.hasNextPage) return keys;
    after = search.pageInfo.endCursor;
  }
  throw new Error(`Issue search "${q}" has more than ${SEARCH_PAGE_SIZE * MAX_SEARCH_PAGES} results; stopped paging`);
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

export interface ProjectSnapshot {
  title: string;
  items: Item[];
}

export async function fetchProject(owner: string, number: number): Promise<ProjectSnapshot> {
  const raws: RawItem[] = [];
  let after: string | null = null;
  let title = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: RawItemsPage = await graphql<RawItemsPage>(ITEMS_QUERY, { owner, number, after });
    const project = res.data.user?.projectV2;
    if (!project) throw new Error(`Project ${owner}/${number} not found`);
    title = project.title;
    raws.push(...project.items.nodes);
    // A slice and its build can sit on different pages, so slices are dropped once all are read.
    if (!project.items.pageInfo.hasNextPage) return { title, items: normalizeItems(raws, await searchLabels(raws)) };
    after = project.items.pageInfo.endCursor;
  }
  throw new Error(`Project has more than ${PAGE_SIZE * MAX_PAGES} items; stopped paging`);
}

/** Looks up the project's Status option once and returns a writer for it. */
async function statusWriter(config: BoardConfig, name: Status, run: (args: string[]) => Promise<string>) {
  const number = config.number ?? await findProjectNumber(config.owner, config.title);
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
    return `Could not set ${name}. ${err instanceof Error ? err.message : 'GitHub request failed.'}`;
  }
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

/** Deletes an issue for good, or removes a draft from the project; returns the error, or null when GitHub accepted it. */
export async function abandonItem(
  config: BoardConfig,
  item: Item,
  run: (args: string[]) => Promise<string> = gh,
): Promise<string | null> {
  try {
    if (item.type === 'DraftIssue') {
      const number = config.number ?? await findProjectNumber(config.owner, config.title);
      await run(['project', 'item-delete', String(number), '--owner', config.owner, '--id', item.id]);
    } else await run(['issue', 'delete', String(item.number), '-R', item.repo!, '--yes']);
    return null;
  } catch (err) {
    const what = item.type === 'DraftIssue' ? `remove draft ${item.title}` : `delete #${item.number}`;
    return `Could not ${what}. ${err instanceof Error ? err.message : 'GitHub request failed.'}`;
  }
}

/** Creates an issue, adds it to the configured project and explicitly assigns List. */
export async function addProjectItem(
  config: BoardConfig,
  input: unknown,
  progress: CreationProgress,
  run: (args: string[]) => Promise<string> = gh,
): Promise<CreationResult> {
  const draft = validateDraft(input, config.repos);
  let step = 'project setup';
  const uncertain = (): CreationResult => ({ item: null, issueUrl: null, uncertain: true,
    error: 'Issue creation could not be confirmed. Check the repository issues before starting a new item; this submission will not create another issue.' });
  if (progress.creationUncertain) return uncertain();
  try {
    if (progress.item) return { item: progress.item, issueUrl: progress.item.url, error: null };
    const { number, setStatus } = await statusWriter(config, 'List', run);
    const labels = [draft.kind, ...draft.labels];
    step = 'issue creation';
    if (!progress.issue) {
      // A CLI timeout can happen after GitHub accepted the issue. Never blindly recreate it.
      progress.creationUncertain = true;
      const issue = JSON.parse(await run(['api', '--method', 'POST', `repos/${draft.repo}/issues`,
        '-f', `title=${draft.title}`, '-f', `body=${draft.description}`,
        ...labels.flatMap((label) => ['-f', `labels[]=${label}`])])) as NonNullable<CreationProgress['issue']>;
      if (!Number.isSafeInteger(issue.number) || issue.html_url !== `https://github.com/${draft.repo}/issues/${issue.number}`) {
        throw new Error('GitHub did not return an issue identity.');
      }
      progress.issue = issue;
      progress.creationUncertain = false;
    }
    const issue = progress.issue;
    step = 'project membership';
    if (!progress.itemId) {
      // GitHub item-add reuses membership when the issue is already on this project.
      const member = JSON.parse(await run(['project', 'item-add', String(number), '--owner', config.owner,
        '--url', issue.html_url, '--format', 'json'])) as { id: string };
      if (!member.id) throw new Error('GitHub did not return a project item.');
      progress.itemId = member.id;
    }
    step = 'List status';
    await setStatus(progress.itemId);
    progress.item = {
      id: progress.itemId, status: 'List', type: 'Issue', number: issue.number,
      title: draft.title, url: issue.html_url, repo: draft.repo, labels, state: 'OPEN',
      parent: null, subIssues: { total: 0, completed: 0 }, blockedBy: 0,
      updatedAt: issue.updated_at, closedAt: null, linkedPrs: [], slices: [],
    };
    return { item: progress.item, issueUrl: issue.html_url, error: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'GitHub request failed.';
    // A definite client rejection did not create an issue and can be corrected/retried.
    if (step === 'issue creation' && /HTTP (?:400|401|403|404|410|422)\b/.test(detail)) progress.creationUncertain = false;
    if (progress.creationUncertain) return uncertain();
    return { item: null, issueUrl: progress.issue?.html_url ?? null,
      error: `Could not finish ${step}. ${detail}` };
  }
}
