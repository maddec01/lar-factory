// Reads the Mux project through the local `gh` CLI (`gh api graphql`).

import { execFile } from 'node:child_process';
import { STATUSES } from './model.ts';
import type { Checks, ContentType, IssueLinks, IssueRef, Item, LinkedPr, Status } from './model.ts';
import type { BoardConfig } from './config.ts';
import type { CreationProgress, CreationResult } from './add-item.ts';
import { validateDraft } from './add-item.ts';

const GH = process.env.GH_PATH || 'gh';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
/** Checks read per PR for the start time; the counts always cover all of them. */
const CHECK_SLICE = 20;
/** Blocked-by and blocking links read per issue; the rest are counted. */
const LINK_SLICE = 20;

export const ITEMS_QUERY = `query($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      title
      url
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
              issueDependenciesSummary { blockedBy }
              blockedBy(first: ${LINK_SLICE}) { ...links }
              blocking(first: ${LINK_SLICE}) { ...links }
              closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
                nodes {
                  number url state isDraft
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
}

fragment links on IssueConnection {
  totalCount
  nodes { number title url state repository { nameWithOwner } }
}`;

const FIND_PROJECT_QUERY = `query($owner: String!, $title: String!) {
  user(login: $owner) { projectsV2(first: 50, query: $title) { nodes { number title } } }
}`;

// ---------- raw GraphQL shapes ----------

interface RawLabelConn {
  nodes: { name: string }[];
}

interface RawIssueRef {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  repository: { nameWithOwner: string };
}

interface RawIssueLinks {
  totalCount: number;
  nodes: RawIssueRef[];
}

interface RawContent {
  __typename: ContentType;
  title: string;
  updatedAt: string;
  number?: number;
  url?: string;
  state?: string;
  closedAt?: string | null;
  isDraft?: boolean;
  repository?: { nameWithOwner: string };
  labels?: RawLabelConn;
  parent?: RawIssueRef | null;
  subIssuesSummary?: { total: number; completed: number };
  issueDependenciesSummary?: { blockedBy: number };
  blockedBy?: RawIssueLinks;
  blocking?: RawIssueLinks;
  closedByPullRequestsReferences?: { nodes: RawLinkedPr[] };
}

interface RawStateCount {
  state: string;
  count: number;
}

export interface RawLinkedPr {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  statusCheckRollup?: {
    contexts: {
      checkRunCountsByState: RawStateCount[];
      statusContextCountsByState: RawStateCount[];
      nodes: {
        status?: string;
        startedAt?: string | null;
        checkSuite?: { createdAt: string };
        state?: string;
        createdAt?: string;
      }[];
    };
  } | null;
}

export interface RawItem {
  id: string;
  updatedAt: string;
  status: { name?: string } | null;
  content: RawContent | null;
}

export interface RawItemsPage {
  data: {
    user: {
      projectV2: {
        title: string;
        url: string;
        items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItem[] };
      } | null;
    } | null;
  };
}

// ---------- normalizing ----------

type CheckOutcome = 'passed' | 'failed' | 'running';

// Check run states (CheckStatusState and CheckConclusionState) and commit status states.
const CHECK_RUN_OUTCOMES: Record<string, CheckOutcome> = {
  SUCCESS: 'passed', NEUTRAL: 'passed', SKIPPED: 'passed', COMPLETED: 'passed',
  FAILURE: 'failed', CANCELLED: 'failed', TIMED_OUT: 'failed', ACTION_REQUIRED: 'failed',
  STARTUP_FAILURE: 'failed', STALE: 'failed',
  IN_PROGRESS: 'running', QUEUED: 'running', PENDING: 'running', WAITING: 'running', REQUESTED: 'running',
};
const STATUS_CONTEXT_OUTCOMES: Record<string, CheckOutcome> = {
  SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'running', EXPECTED: 'running',
};

/** Counts a PR's checks by outcome; null when it has none. */
export function normalizeChecks(rollup: RawLinkedPr['statusCheckRollup']): Checks | null {
  if (!rollup) return null;
  const checks: Checks = { passed: 0, failed: 0, running: 0, total: 0, since: null };
  const tally = (counts: RawStateCount[], outcomes: Record<string, CheckOutcome>) => {
    for (const { state, count } of counts) {
      const outcome = outcomes[state];
      if (!outcome) continue;
      checks[outcome] += count;
      checks.total += count;
    }
  };
  tally(rollup.contexts.checkRunCountsByState, CHECK_RUN_OUTCOMES);
  tally(rollup.contexts.statusContextCountsByState, STATUS_CONTEXT_OUTCOMES);
  if (!checks.total) return null;
  // A rerun on the same head keeps its finished checks, so time only the running ones.
  // A queued check has no start yet; its suite's creation still times a stuck runner.
  checks.since = rollup.contexts.nodes
    .filter((n) => (n.status && CHECK_RUN_OUTCOMES[n.status] === 'running') || (n.state && STATUS_CONTEXT_OUTCOMES[n.state] === 'running'))
    .map((n) => n.startedAt ?? n.checkSuite?.createdAt ?? n.createdAt)
    .filter((at) => !!at)
    .sort()[0] ?? null;
  return checks;
}

function normalizeLinkedPr({ statusCheckRollup, ...pr }: RawLinkedPr): LinkedPr {
  return { ...pr, checks: normalizeChecks(statusCheckRollup) };
}

function toStatus(name: string | undefined): Status {
  return (STATUSES as readonly string[]).includes(name ?? '') ? (name as Status) : 'List';
}

function normalizeIssueRef(raw: RawIssueRef): IssueRef {
  return { number: raw.number, title: raw.title, url: raw.url, repo: raw.repository.nameWithOwner, state: raw.state };
}

/** Drafts and PRs have no links. */
function normalizeLinks(raw: RawIssueLinks | undefined): IssueLinks {
  return { total: raw?.totalCount ?? 0, nodes: raw?.nodes.map(normalizeIssueRef) ?? [] };
}

/** Turns one raw project item into the board's Item; null for items we can't see. */
export function normalizeItem(raw: RawItem): Item | null {
  const c = raw.content;
  if (!c) return null;
  const updated = [raw.updatedAt, c.updatedAt].filter(Boolean).sort().at(-1) ?? raw.updatedAt;
  return {
    id: raw.id,
    status: toStatus(raw.status?.name),
    type: c.__typename,
    number: c.number ?? null,
    title: c.title,
    url: c.url ?? null,
    repo: c.repository?.nameWithOwner ?? null,
    labels: c.labels?.nodes.map((l) => l.name) ?? [],
    state: c.state ?? null,
    parent: c.parent ? normalizeIssueRef(c.parent) : null,
    subIssues: c.subIssuesSummary ?? { total: 0, completed: 0 },
    blockedBy: c.issueDependenciesSummary?.blockedBy ?? 0,
    blockers: normalizeLinks(c.blockedBy),
    blocking: normalizeLinks(c.blocking),
    updatedAt: updated,
    closedAt: c.closedAt ?? null,
    linkedPrs: c.closedByPullRequestsReferences?.nodes.map(normalizeLinkedPr) ?? [],
  };
}

// ---------- gh ----------

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(GH, args, { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
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

export interface ProjectSnapshot {
  title: string;
  url: string;
  items: Item[];
}

export async function fetchProject(owner: string, number: number): Promise<ProjectSnapshot> {
  const items: Item[] = [];
  let after: string | null = null;
  let title = '';
  let url = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: RawItemsPage = await graphql<RawItemsPage>(ITEMS_QUERY, { owner, number, after });
    const project = res.data.user?.projectV2;
    if (!project) throw new Error(`Project ${owner}/${number} not found`);
    title = project.title;
    url = project.url;
    for (const raw of project.items.nodes) {
      const item = normalizeItem(raw);
      if (item) items.push(item);
    }
    if (!project.items.pageInfo.hasNextPage) return { title, url, items };
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
      blockers: { total: 0, nodes: [] }, blocking: { total: 0, nodes: [] },
      updatedAt: issue.updated_at, closedAt: null, linkedPrs: [],
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
