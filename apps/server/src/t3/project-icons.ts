// Repository icons from T3: each project's chosen icon, or its favicon's bytes held in memory for the board's image
// endpoint. The page only gets a project ID and a content hash, so T3's paths, signed URLs and session stay here.

import { createHash } from 'node:crypto';
import { isRecord, type BoardData, type ProjectIcon } from '@lar-factory/shared';
import type { BoardState } from '../board/board-state.ts';
import { log } from '../log.ts';
import type { ProjectFact } from './project-protocol.ts';
import { checkoutsOf, observedCheckouts } from './repository-project.ts';
import { repositoryProjectAccess, repositoryProjects } from './repository-project-discovery.ts';
import { subscribeProjects } from './project-subscription.ts';

const REFRESH_MS = 240_000;
const FETCH_MS = 5_000;
const MAX_BYTES = 1024 * 1024;
const MAX_FETCHES = 4;
/** T3 also allows .icns, which a browser can't draw. */
const MEDIA_TYPES = new Set(['image/avif', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']);

export interface ProjectImage { type: string; body: Buffer }
interface Favicon extends ProjectImage { revision: string }
type Access = NonNullable<ReturnType<typeof repositoryProjectAccess>>;

/** Whether T3 failed the request because the project has no such favicon, as when a set path's file was deleted. */
const faviconNotFound = (exit: unknown) => isRecord(exit) && Array.isArray(exit.cause)
  && exit.cause.some(part => isRecord(part) && isRecord(part.error) && part.error._tag === 'AssetProjectFaviconNotFoundError');

/** T3's signed URL for the project's favicon, null when T3 finds none, or undefined when it says neither. The board's session stays valid whatever this request meets. */
function faviconUrl(access: Access, project: ProjectFact, signal: AbortSignal): Promise<string | null | undefined> {
  return new Promise(resolve => {
    let stop: (() => void) | undefined;
    const finish = (url?: string | null) => {
      signal.removeEventListener('abort', abort);
      stop?.();
      resolve(url);
    };
    const abort = () => finish();
    signal.addEventListener('abort', abort);
    const protocol = { subscriptionSession: () => access.protocol.subscriptionSession(), invalidateSession() {} };
    try {
      stop = subscribeProjects(access.origin, '', protocol, () => finish(), {
        tag: 'assets.createUrl',
        payload: { resource: { _tag: 'project-favicon', cwd: project.workspaceRoot, ...(project.faviconPath === null ? {} : { path: project.faviconPath }) } },
        accept(value) { finish(isRecord(value) && typeof value.relativeUrl === 'string' ? value.relativeUrl : undefined); },
        reject(exit) { finish(faviconNotFound(exit) ? null : undefined); },
      });
    } catch { finish(); }
  });
}

/** The response's body, or undefined past the limit, where reading stops. */
async function limitedBody(response: Response): Promise<Buffer | undefined> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
    size += part.value.length;
    if (size > MAX_BYTES) { await reader?.cancel(); return undefined; }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}

/** The project's favicon, 'absent' when T3 has none or answers with a file the board can't use, or undefined when this attempt shows nothing either way. */
async function readFavicon(access: Access, project: ProjectFact): Promise<Favicon | 'absent' | undefined> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FETCH_MS);
  try {
    const relative = await faviconUrl(access, project, deadline.signal);
    if (relative === null) return 'absent';
    if (relative === undefined) return undefined;
    const url = new URL(relative, access.origin);
    if (url.origin !== access.origin.origin) return undefined;
    const response = await fetch(url, { redirect: 'error', signal: deadline.signal });
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!response.ok || !MEDIA_TYPES.has(type)) {
      await response.body?.cancel();
      return response.ok || response.status === 404 ? 'absent' : undefined;
    }
    const body = await limitedBody(response);
    if (!body?.length) return 'absent';
    return { type, body, revision: createHash('sha256').update(body).digest('hex').slice(0, 16) };
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}

const repositories = (data: BoardData) => [...data.repos, ...data.onboarding ?? []].map(({ repo }) => repo);

export interface ProjectIcons {
  /** Reads T3 once and updates the board when an icon changed. Calls during a refresh share it. */
  refresh(): Promise<void>;
  /** Refreshes now, on a timer of its own and when the repositories change, until the returned function is called. */
  start(): () => void;
  /** The favicon's bytes for a project in T3's current or retained observation. */
  image(projectId: string): Promise<ProjectImage | undefined>;
}

export function createProjectIcons(board: Pick<BoardState, 'snapshot' | 'update' | 'push' | 'subscribe'>): ProjectIcons {
  const favicons = new Map<string, Favicon>();
  let published = '{}';
  let pending: Promise<void> | undefined;

  async function read(): Promise<void> {
    const projectRead = await repositoryProjects();
    const projects = new Map(projectRead.observation?.projects.map(project => [project.id, project]));
    for (const id of favicons.keys()) if (!projects.has(id)) favicons.delete(id);
    // T3 may be down, so these come from the retained observation, unlike Start's lookup.
    const found = projectRead.observation ? await observedCheckouts(projectRead.observation) : [];
    const owners = repositories(board.snapshot()).flatMap((repo): [string, ProjectFact][] => {
      const [only, ...others] = checkoutsOf(found, repo);
      const project = only && !others.length ? projects.get(only.id) : undefined;
      return project ? [[repo, project]] : [];
    });
    const access = projectRead.availability === 'available' ? repositoryProjectAccess() : undefined;
    const owned = [...new Map(owners.map(([, project]) => [project.id, project])).values()];
    for (const { id, projectIcon } of owned) if (projectIcon) favicons.delete(id);
    if (access) {
      const queue = owned.filter(({ projectIcon }) => !projectIcon);
      await Promise.all(Array.from({ length: MAX_FETCHES }, async () => {
        for (let project = queue.shift(); project; project = queue.shift()) {
          const favicon = await readFavicon(access, project);
          if (favicon === 'absent') favicons.delete(project.id);
          else if (favicon) favicons.set(project.id, favicon);
        }
      }));
    }
    const icons = Object.fromEntries(owners.flatMap(([repo, { id, projectIcon }]): [string, ProjectIcon][] => {
      const favicon = favicons.get(id);
      if (projectIcon) return [[repo, projectIcon]];
      return favicon ? [[repo, { kind: 'favicon', projectId: id, revision: favicon.revision }]] : [];
    }));
    const next = JSON.stringify(icons);
    if (next === published) return;
    published = next;
    board.update({ projectIcons: icons });
    board.push();
  }

  const refresh = () => {
    pending ??= read().catch(() => log('reading T3 project icons failed')).finally(() => { pending = undefined; });
    return pending;
  };

  return {
    refresh,
    start() {
      const listed = () => repositories(board.snapshot()).join('\n');
      let known = listed();
      void refresh();
      const timer = setInterval(() => void refresh(), REFRESH_MS);
      const unsubscribe = board.subscribe(() => {
        if (listed() === known) return;
        known = listed();
        void refresh();
      });
      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    },
    async image(projectId) {
      const { observation } = await repositoryProjects();
      if (!observation?.projects.some(({ id }) => id === projectId)) return undefined;
      const favicon = favicons.get(projectId);
      return favicon && { type: favicon.type, body: favicon.body };
    },
  };
}
