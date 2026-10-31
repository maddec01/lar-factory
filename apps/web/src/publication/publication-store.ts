import { create } from 'zustand';
import type { PublicationBoardState, PublicationDocument, PublicationTextConflict, RepositorySetup } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import { useBoardStore } from '../board/board-store.ts';

interface PublicationState {
  workId: string | null;
  state: PublicationBoardState | null;
  busy: boolean;
  error: string | null;
  conflict: PublicationTextConflict | null;
  mode: 'setup' | 'edit' | 'preview';
  documents: PublicationDocument[];
  typeSelections: Record<string, string | null>;
  open(workId: string): Promise<void>;
  close(): void;
  editDocument(workId: string, change: Partial<PublicationDocument>): void;
  chooseType(workId: string, type: string | null): void;
  setMode(mode: PublicationState['mode']): void;
  saveSetting(repo: string, change: object): Promise<boolean>;
  request(action: string, extra?: object): Promise<boolean>;
}

/** Only drafts and the open dialog live here. Every open and operation reads the journal from the server. */
export const usePublicationStore = create<PublicationState>()((set, get) => ({
  workId: null, state: null, busy: false, error: null, conflict: null, mode: 'setup', documents: [], typeSelections: {},
  async open(workId) {
    if (get().busy) return;
    set({ workId, state: null, documents: [], typeSelections: {}, error: null, conflict: null });
    if (!await get().request('open')) return;
    const state = get().state!;
    set({ mode: state.pending ? 'preview' : state.firstUse ? 'setup' : 'edit' });
  },
  close() { if (!get().busy) set({ workId: null, state: null, documents: [], typeSelections: {}, error: null, conflict: null }); },
  editDocument(workId, change) { set({ documents: get().documents.map((doc) => doc.workId === workId ? { ...doc, ...change } : doc) }); },
  chooseType(workId, type) { set({ typeSelections: { ...get().typeSelections, [workId]: type } }); },
  setMode(mode) { set({ mode, error: null }); },
  async saveSetting(repo, change) {
    if (get().busy) return false;
    set({ busy: true, error: null });
    const result = await postAction<{ setup: RepositorySetup }>('/api/repositories/settings', { repo, ...change });
    receive(result);
    const state = get().state;
    if ('key' in change && !result.error) set({ typeSelections: {} });
    if (state && result.setup) set({ state: { ...state, settings: state.settings.map((item) => item.setup.repo === repo ? { ...item, setup: result.setup! } : item) } });
    set({ busy: false, error: result.error });
    return !result.error;
  },
  async request(action, extra = {}) {
    if (get().busy || !get().workId) return false;
    const { workId, state } = get();
    const plan = state?.pending?.plan;
    set({ busy: true, error: null });
    const result = await postAction<PublicationBoardState & { conflict?: PublicationTextConflict }>(`/api/publication/${action}`, {
      workId, session: useBoardStore.getState().data.capture?.session,
      ...action !== 'open' && action !== 'prepare' && plan && { planId: plan.planId },
      ...['approve', 'resume'].includes(action) && plan && { revision: plan.revision, digest: plan.digest }, ...extra,
    });
    if (result.readiness) {
      const documents = (result.sources ?? []).map((source) => get().documents.find((doc) => doc.workId === source.workId) ?? {
        workId: source.workId, title: source.title, outcome: '', change: '', checks: [], assumptions: [], decisions: [], builderNotes: [], domainNotes: [], relatedTickets: [],
      });
      const changedVocabulary = JSON.stringify(state?.settings.map((config) => config.setup.vocabulary)) !== JSON.stringify(result.settings?.map((config) => config.setup.vocabulary));
      set({ state: result as PublicationBoardState, documents, ...changedVocabulary && { typeSelections: {} }, ...result.pending && { mode: 'preview' } });
    }
    set({ busy: false, error: result.error, conflict: result.conflict ?? null });
    return !result.error;
  },
}));
