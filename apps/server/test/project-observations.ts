import type { ChosenProjectIcon } from '@lar-factory/shared';
import { appendFileSync } from 'node:fs';

import type { BoardSessions } from '../src/t3/board-projects.ts';
import type { ProjectRead } from '../src/t3/project-protocol.ts';
import { liveProjects } from '../src/t3/t3-db.ts';
import { statsDbPath } from '../src/t3/t3-settings.ts';

export async function repositoryProjects(env: NodeJS.ProcessEnv = process.env): Promise<ProjectRead> {
    if (env.FAKE_T3_READS) appendFileSync(env.FAKE_T3_READS, 'read\n');
    try {
        return {
            availability: 'available',
            observation: {
                observedAt: new Date().toISOString(),
                projects: liveProjects(statsDbPath(env), env.HOME ?? '').map((p) => ({
                    id: p.id,
                    title: p.title,
                    workspaceRoot: p.folder,
                    faviconPath: null,
                    projectIcon: env.FAKE_T3_ICON ? (JSON.parse(env.FAKE_T3_ICON) as ChosenProjectIcon) : null,
                })),
            },
        };
    } catch {
        return { availability: 'unavailable' };
    }
}

/** Spawned boards have no T3 to ask for favicons. */
export const repositoryProjectAccess = () => undefined;

/** Spawned boards read projects afresh on each call, so nothing here announces a change. */
export const subscribeRepositoryProjects =
    (_changed: () => void): (() => void) =>
    () => {};

/** Spawned boards issue no session, so a sample board holds this one to revoke when it stops. */
export const useProjectSessions = ({ vault }: BoardSessions): void => {
    void vault.write({ token: 'fake-token', sessionId: 'fake-session', expiresAt: '2099-01-01T00:00:00Z' });
};

export async function reauthorizeRepositoryProjects(): Promise<ProjectRead> {
    return repositoryProjects();
}
