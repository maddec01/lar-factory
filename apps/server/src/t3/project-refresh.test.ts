import type { BoardData, RepoConfig } from '@lar-factory/shared';
import { expect, it, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import type { ProjectRead } from './project-protocol.ts';
import { createProjectRefresh } from './project-refresh.ts';

const fixture = vi.hoisted(() => ({
    read: { availability: 'unavailable' } as ProjectRead,
    hints: vi.fn<
        () => Promise<{
            repositoryProjects: Record<string, string | null>;
            t3Defaults: Record<string, import('@lar-factory/shared').ModelSelection>;
        }>
    >(async () => ({ repositoryProjects: { 'owner/repo': 'Disconnected' }, t3Defaults: {} })),
}));

vi.mock('./repository-project-discovery.ts', () => ({ repositoryProjects: async () => fixture.read }));
vi.mock('./repository-project.ts', () => ({ repositoryProjectReads: () => fixture.hints() }));

it('clears launch holds and reloads models/defaults on recovery without a tracker read', async () => {
    const board = createBoardState({ modelChoices: [] } as unknown as BoardData);
    const models = vi.fn(() => board.update({ modelChoices: [] }));
    const refresh = createProjectRefresh(board, () => [{ repo: 'owner/repo' }] as RepoConfig[], models);

    await refresh();
    expect(board.snapshot().repositoryProjects).toEqual({ 'owner/repo': 'Disconnected' });
    fixture.read = { availability: 'available', observation: { observedAt: '2026-11-13', projects: [] } };

    const selection = { instanceId: 'codex', model: 'fixture' };
    const modelChoices = [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'fixture', label: 'Fixture' }] }];

    fixture.hints.mockResolvedValue({
        repositoryProjects: { 'owner/repo': null },
        t3Defaults: { 'owner/repo': selection },
    });
    models.mockImplementation(() => board.update({ modelChoices }));
    await refresh();
    expect(board.snapshot()).toMatchObject({
        t3Availability: { availability: 'available' },
        repositoryProjects: { 'owner/repo': null },
        t3Defaults: { 'owner/repo': selection },
        modelChoices,
    });
    fixture.hints.mockClear();
    await refresh();
    expect(fixture.hints).not.toHaveBeenCalled();
    await refresh(true);
    expect(fixture.hints).toHaveBeenCalledTimes(1);
});

it('does not publish a stale hold when T3 recovers during a checkout read', async () => {
    const board = createBoardState({ modelChoices: [] } as unknown as BoardData);
    const refresh = createProjectRefresh(
        board,
        () => [],
        () => {},
    );

    fixture.read = { availability: 'unavailable' };
    fixture.hints.mockImplementationOnce(async () => {
        fixture.read = { availability: 'available' };

        return { repositoryProjects: { 'owner/repo': 'Disconnected' }, t3Defaults: {} };
    });
    await refresh();
    expect(board.snapshot().repositoryProjects).toBeUndefined();
    await refresh();
    expect(board.snapshot().t3Availability?.availability).toBe('available');
});
