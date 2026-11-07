// The board's Scope, Kind and Labels, saved on this machine. The board search and the List modal's Scope board set the
// saved Scope; the board reads the shown one, as a saved repository can leave the board and come back.

import { listRepos, sameRepo } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { create } from 'zustand';

import { readFilters } from '../filters/item-filters.ts';
import type { ItemFilters } from '../filters/item-filters.ts';
import { useBoardStore } from './board-store.ts';

const SCOPE_KEY = 'lar-board:scope';
const FILTERS_KEY = 'lar-board:filters:board';

function readScope(): string | null {
    try {
        return localStorage.getItem(SCOPE_KEY) || null;
    } catch {
        return null;
    }
}

/** Runs a storage write. Blocked storage only costs the save: the choice still holds until the page reloads. */
function save(write: () => void): void {
    try {
        write();
    } catch {
        // Nothing to do: the store keeps the choice.
    }
}

interface ScopeState {
    /** The repository last chosen, as a repository key, or `null` for all repositories. Read `useShownScope` to show it. */
    savedScope: string | null;
    setScope: (scope: string | null) => void;
    filters: ItemFilters;
    setFilters: (filters: ItemFilters) => void;
}

export const useScopeStore = create<ScopeState>()((set) => ({
    savedScope: readScope(),
    setScope: (scope) => {
        save(() => (scope ? localStorage.setItem(SCOPE_KEY, scope) : localStorage.removeItem(SCOPE_KEY)));
        set({ savedScope: scope });
    },
    filters: readFilters(FILTERS_KEY),
    setFilters: (filters) => {
        save(() => localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)));
        set({ filters });
    },
}));

/** The Scope the board shows: the saved repository as the board search names it. Until the first read settles it may yet land; after that, one the search doesn't offer shows as all repositories. */
const shownScope = (saved: string | null, data: BoardData): string | null =>
    !saved || !data.firstRead.settled ? saved : (listRepos(data).find((repo) => sameRepo(repo, saved)) ?? null);

export function useShownScope(): string | null {
    const saved = useScopeStore((state) => state.savedScope);
    return useBoardStore((state) => shownScope(saved, state.data));
}
