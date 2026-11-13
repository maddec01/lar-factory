import type { BoardState } from '../board/board-state.ts';
import type { ProjectRead } from './project-protocol.ts';
import { repositoryProjects } from './repository-project-discovery.ts';
import { repositoryProjectReads } from './repository-project.ts';

const sourceKey = (read: ProjectRead) => JSON.stringify([read.availability, read.observation?.projects]);

/** Refresh launch prerequisites independently of tracker reads, including after reconnect. */
export function createProjectRefresh(board: BoardState, repos: () => readonly { repo: string }[], models: () => void) {
    let pending: Promise<void> | undefined;
    let applied = '';
    let refreshedAt = 0;
    const refresh = async () => {
        const read = await repositoryProjects();
        const listed = repos();

        models();

        const key = JSON.stringify([sourceKey(read), listed, board.snapshot().modelChoices]);
        const hints = key !== applied || Date.now() - refreshedAt >= 30_000 ? await repositoryProjectReads(listed) : {};

        // A socket update during checkout reads must not publish stale launch holds.
        if (
            sourceKey(read) !== sourceKey(await repositoryProjects()) ||
            JSON.stringify(listed) !== JSON.stringify(repos())
        )
            return;

        applied = key;

        if ('repositoryProjects' in hints) refreshedAt = Date.now();

        board.update({
            ...hints,
            t3Availability: { availability: read.availability, observedAt: read.observation?.observedAt },
        });
        board.push();
    };

    return async (force = false) => {
        if (force) {
            await pending;
            applied = '';
        }

        pending ??= refresh().finally(() => {
            pending = undefined;
        });

        return pending;
    };
}
