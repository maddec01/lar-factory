// Reads the Mux project through the local `gh` CLI (`gh api graphql`).

import { execFile } from 'node:child_process';
import { STATUSES } from './model.ts';
import type { ContentType, Item, Status } from './model.ts';

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
