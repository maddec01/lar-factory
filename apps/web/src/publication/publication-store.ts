import { create } from 'zustand';
import type { PublicationBoardState, PublicationDocument, PublicationLocation, PublicationTextConflict, RepositorySetup } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import { useBoardStore } from '../board/board-store.ts';
import { detailsCache } from '../item-dialog/details-cache.ts';

interface PublicationState {
  workId: string | null;
  state: PublicationBoardState | null;
  busy: boolean;
  error: string | null;
  conflict: PublicationTextConflict | null;
  mode: 'setup' | 'edit' | 'preview';
  documents: PublicationDocument[];
  typeSelections: Record<string, string | null>;
  delivery: Record<string, 'body' | 'comment' | 'handover'>;
  resolutions: Record<string, { observedText: string; expectedText: string; location: PublicationLocation }>;
  refused: boolean;
  needsInspection: boolean;
  open(workId: string): Promise<void>;
  close(): void;
  editDocument(workId: string, change: Partial<PublicationDocument>): void;
  chooseType(workId: string, type: string | null): void;
  chooseDelivery(workId: string, delivery: 'body' | 'comment' | 'handover'): void;
  resolveText(conflict: PublicationTextConflict, location: PublicationLocation): void;
  prepare(): Promise<boolean>;
  setMode(mode: PublicationState['mode']): void;
  saveSetting(repo: string, change: object): Promise<boolean>;
  request(action: string, extra?: object): Promise<boolean>;
}

/** Only drafts and the open dialog live here. Every open and operation reads the journal from the server. */
export const usePublicationStore = create<PublicationState>()((set, get) => ({
  workId: null, state: null, busy: false, error: null, conflict: null, mode: 'setup', documents: [], typeSelections: {}, delivery: {}, resolutions: {}, refused: false, needsInspection: false,
  async open(workId) {
    if (get().busy) return;
    set({ workId, state: null, documents: [], typeSelections: {}, delivery: {}, resolutions: {}, refused: false, needsInspection: false, error: null, conflict: null });
    if (!await get().request('open')) return;
    const state = get().state!;
    set({ mode: state.pending ? 'preview' : state.firstUse ? 'setup' : 'edit' });
  },
  close() { if (!get().busy) set({ workId: null, state: null, documents: [], typeSelections: {}, error: null, conflict: null }); },
  editDocument(workId, change) { set({ documents: get().documents.map((doc) => doc.workId === workId ? { ...doc, ...change } : doc) }); },
  chooseType(workId, type) { set({ typeSelections: { ...get().typeSelections, [workId]: type } }); },
  chooseDelivery(workId, delivery) { set({ delivery: { ...get().delivery, [workId]: delivery } }); },
  resolveText(conflict, location) {
    const expectedText = location.kind === 'body' ? conflict.current.slice(location.start, location.end) : conflict.current;
    set({ resolutions: { ...get().resolutions, [conflict.workId]: { observedText: conflict.current, expectedText, location } }, mode: 'edit', error: null });
  },
  async prepare() {
    const { state, documents, typeSelections, delivery, resolutions } = get();
    if (!state) return false;
    return get().request('prepare', { documents, typeSelections, delivery, resolutions,
      sources: state.readiness.sources.map(({ workId, revision }) => ({ workId, revision })),
      ...state.pending && { replaces: state.pending.plan.planId } });
  },
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
    if (get().needsInspection && !['open', 'inspect', 'reconcile', 'reconcile-url'].includes(action)) return false;
    const { workId, state } = get();
    const plan = state?.pending?.plan;
    set({ busy: true, error: null });
    const result = await postAction<PublicationBoardState & { conflict?: PublicationTextConflict; alternatives?: unknown[] }>(`/api/publication/${action}`, {
      workId, session: useBoardStore.getState().data.capture?.session,
      ...action !== 'open' && action !== 'prepare' && plan && { planId: plan.planId },
      ...['approve', 'resume'].includes(action) && plan && { revision: plan.revision, digest: plan.digest }, ...extra,
    });
    if (result.readiness) {
      const documents = (result.sources ?? []).map((source) => get().documents.find((doc) => doc.workId === source.workId) ?? {
        workId: source.workId, title: source.title, outcome: '', change: '', checks: [], assumptions: [], decisions: [], builderNotes: [], domainNotes: [], relatedTickets: [],
      });
      const changedVocabulary = JSON.stringify(state?.settings.map((config) => config.setup.vocabulary)) !== JSON.stringify(result.settings?.map((config) => config.setup.vocabulary));
      for (const completed of result.pending?.plan.results ?? []) if (completed.status === 'successful') detailsCache.drop(completed.operation.ticketWorkId);
      for (const attachment of result.attachments ?? []) detailsCache.drop(attachment.workId);
      set({ state: result as PublicationBoardState, documents, needsInspection: false, ...changedVocabulary && { typeSelections: {} }, ...result.pending && { mode: 'preview' } });
    }
    set({ busy: false, error: result.error, conflict: result.conflict ?? null, refused: !!result.alternatives,
      ...result.error === "Can't reach the board server. Try again." && { needsInspection: true } });
    return !result.error;
  },
}));
