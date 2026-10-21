// Reads the Mux project through the local `gh` CLI (`gh api graphql`).

import { execFile } from 'node:child_process';
import { STATUSES } from './model.ts';
import type { ContentType, Item, Status } from './model.ts';
import type { BoardConfig } from './config.ts';
import type { CreationProgress, CreationResult } from './add-item.ts';
import { validateDraft } from './add-item.ts';

const GH = process.env.GH_PATH || 'gh';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

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
              parent { number title url repository { nameWithOwner } }
              subIssuesSummary { total completed }
              issueDependenciesSummary { blockedBy }
              closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
                nodes { number url state isDraft }
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

const FIND_PROJECT_QUERY = `query($owner: String!, $title: String!) {
  user(login: $owner) { projectsV2(first: 50, query: $title) { nodes { number title } } }
}`;

// ---------- raw GraphQL shapes ----------

interface RawLabelConn {
  nodes: { name: string }[];
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
  parent?: { number: number; title: string; url: string; repository: { nameWithOwner: string } } | null;
  subIssuesSummary?: { total: number; completed: number };
  issueDependenciesSummary?: { blockedBy: number };
  closedByPullRequestsReferences?: {
    nodes: { number: number; url: string; state: string; isDraft: boolean }[];
  };
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

function toStatus(name: string | undefined): Status {
  return (STATUSES as readonly string[]).includes(name ?? '') ? (name as Status) : 'List';
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
    parent: c.parent
      ? {
          number: c.parent.number,
          title: c.parent.title,
          url: c.parent.url,
          repo: c.parent.repository.nameWithOwner,
        }
      : null,
    subIssues: c.subIssuesSummary ?? { total: 0, completed: 0 },
    blockedBy: c.issueDependenciesSummary?.blockedBy ?? 0,
    updatedAt: updated,
    closedAt: c.closedAt ?? null,
    linkedPrs: c.closedByPullRequestsReferences?.nodes ?? [],
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
