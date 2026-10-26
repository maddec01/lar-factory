// What the onboarding page tests share: a board with no repository onboarded, and T3's projects for the server to list.

import { vi } from 'vite-plus/test';
import { $, fetchMock, mountPage, sample, settle } from '../../test/support.ts';
import type { BoardData, ProjectChoice } from '@lar-factory/shared';

export const empty: BoardData = { ...sample, repos: [], items: [], repositoryConfigProblems: [], error: null };

export const project = (name: string, parts: Partial<ProjectChoice> = {}): ProjectChoice => ({
  id: name, name, folder: `/Users/me/Developer/${name}`, repo: `maddec01/${name}`, provider: 'GitHub', hasConfig: false, onBoard: false, ...parts,
});

/** Serves `data` as the board and `projects` as T3's projects. */
export function serve(data: BoardData, projects: ProjectChoice[] | { error: string }): void {
  fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/projects'
    ? new Response(JSON.stringify(Array.isArray(projects) ? { projects } : projects), { status: Array.isArray(projects) ? 200 : 502 })
    : new Response(JSON.stringify(data)));
}

export const dialog = () => $('[data-onboarding-dialog]');

/** Mounts the empty board and opens the onboarding dialog from its empty state. */
export async function openOnboarding(projects: ProjectChoice[] | { error: string }): Promise<void> {
  serve(empty, projects);
  await mountPage(empty);
  await settle(() => $<HTMLButtonElement>('[data-onboard]')!.click());
  // Base UI moves focus on the next frame.
  await settle(() => vi.advanceTimersByTime(50));
}
