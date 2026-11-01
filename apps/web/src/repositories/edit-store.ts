// Local repository settings, edited from Settings.
import { create } from 'zustand';
import { type RepositorySetup, type SharedRepositorySettings, type SharedSetting, type TrackerLabel, type VocabularyKey, type VocabularyTerm } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import type { IssueSetting } from './issue-defaults.tsx';

/** Settings whose editor uses text drafts. Vocabulary saves one complete term at a time. */
export type DraftSetting = Exclude<SharedSetting, 'labels' | 'vocabulary' | 'createIssuesFromAddItem' | 'createIssuesFromRetro' | 'writeRefinedSpec'>;

/** The text of each field the dialog edits, by field. */
export interface Drafts {
  role: string;
  team: string;
  skills: string;
  /** `off` or `repository`. */
  domainDocs: string;
  glossary: string;
  adrs: string;
}

/** The fields that make each setting's value. */
const FIELDS: Record<DraftSetting, (keyof Drafts)[]> = {
  role: ['role'], itemSource: ['team'], skills: ['skills'], domainDocs: ['domainDocs', 'glossary', 'adrs'],
};

/** The fields' text for the setup's values; a repository's own domain docs start at the usual paths. */
function draftsOf(setup: RepositorySetup): Drafts {
  const docs = setup.domainDocs.kind === 'repository' ? setup.domainDocs : { kind: 'off', glossary: 'GLOSSARY.md', adrs: 'docs/adr' };
  return { role: setup.role, team: setup.itemSource?.kind === 'azure-board' ? setup.itemSource.team : '',
    skills: setup.skills.join(', '), domainDocs: docs.kind, glossary: docs.glossary, adrs: docs.adrs };
}

const list = (text: string) => text.split(',').map((part) => part.trim()).filter(Boolean);

/** The fields' text, typed or else from the setup. */
export const shownDrafts = (setup: RepositorySetup, typed: Partial<Drafts>): Drafts => ({ ...draftsOf(setup), ...typed });

/** The value `key`'s fields make, or null while one is empty that the value needs. */
export function valueOf(key: DraftSetting, drafts: Drafts): SharedRepositorySettings[SharedSetting] | null {
  switch (key) {
    case 'role': return drafts.role.trim();
    case 'itemSource': return drafts.team.trim() ? { kind: 'azure-board', team: drafts.team.trim() } : null;
    case 'skills': return list(drafts.skills);
    case 'domainDocs':
      if (drafts.domainDocs === 'off') return { kind: 'off' };
      return drafts.glossary.trim() && drafts.adrs.trim() ? { kind: 'repository', glossary: drafts.glossary.trim(), adrs: drafts.adrs.trim() } : null;
  }
}

/** Whether `key`'s fields make a value other than the setup's, so Save has something to set. */
export function canSave(key: DraftSetting, setup: RepositorySetup, typed: Partial<Drafts>): boolean {
  const value = valueOf(key, shownDrafts(setup, typed));
  return value !== null && JSON.stringify(value) !== JSON.stringify(setup[key]);
}

/** One change to the tracker's labels, as the Labels section sends it. */
export type LabelChange = { change: 'create'; name: string } | { change: 'update'; name: string; update: Partial<TrackerLabel> } | { change: 'delete'; name: string };

/** A call to the board: one setting's Save or removal, a label change, Recheck access, Offer, or Accept. */
type Running = SharedSetting | 'recheck' | 'structure-sync';

interface EditState {
  /** The repository whose dialog is open. */
  repo: string | null;
  typed: Partial<Drafts>;
  running: Running | null;
  /** Why the last call failed, by the repository it was for. */
  errors: Record<string, string>;
  /** How many label changes have landed, so what read the tracker's labels reads them again. */
  labelChanges: number;
  open: (repo: string) => void;
  close: () => void;
  type: (field: keyof Drafts, text: string) => void;
  save: (repo: string, key: DraftSetting, setup: RepositorySetup) => Promise<void>;
  reset: (repo: string, key: DraftSetting) => Promise<void>;
  recheck: (repo: string) => Promise<void>;
  structureSync: (repo: string, on: boolean) => Promise<void>;
  vocabulary: (repo: string, key: VocabularyKey, value: VocabularyTerm, newLabels: string[]) => Promise<boolean>;
  issueDefault: (repo: string, key: IssueSetting, on: boolean) => Promise<void>;
  /** Sends a label change to the tracker; the reason it failed, or null. */
  labels: (repo: string, change: LabelChange) => Promise<string | null>;
}

export const useEditStore = create<EditState>()((set, get) => {
  /** Posts the change for `repo`; once it lands, `key`'s typed text gives way to the setup the board sent back. */
  async function call(repo: string, running: Running, change: object, key?: DraftSetting): Promise<void> {
    if (get().running) return;
    const { [repo]: _, ...errors } = get().errors;
    set({ running, errors });
    const result = await postAction('/api/repositories/settings', { repo, ...change });
    receive(result);
    const typed = { ...get().typed };
    if (key && !result.error) for (const field of FIELDS[key]) delete typed[field];
    set({ running: null, typed, errors: result.error ? { ...get().errors, [repo]: result.error } : get().errors });
  }
  return {
    repo: null, typed: {}, running: null, errors: {}, labelChanges: 0,
    open: (repo) => set({ repo, typed: {} }),
    // A call that is running keeps the dialog open until it answers.
    close: () => { if (!get().running) set({ repo: null, typed: {} }); },
    type: (field, text) => set({ typed: { ...get().typed, [field]: text } }),
    save: (repo, key, setup) => {
      const value = valueOf(key, shownDrafts(setup, get().typed));
      return value === null ? Promise.resolve() : call(repo, key, { change: 'override', key, value }, key);
    },
    reset: (repo, key) => call(repo, key, { change: 'override', key }, key),
    recheck: (repo) => call(repo, 'recheck', { change: 'recheck' }),
    structureSync: (repo, on) => call(repo, 'structure-sync', { change: 'structure-sync', value: on }),
    vocabulary: async (repo, key, value, newLabels) => {
      if (get().running) return false;
      await call(repo, 'vocabulary', { change: 'vocabulary', key, value, ...newLabels.length && { newLabels } });
      return !get().errors[repo];
    },
    issueDefault: (repo, key, on) => call(repo, key, { change: 'override', key, value: on }),
    labels: async (repo, change) => {
      if (get().running) return 'Another change is still running.';
      set({ running: 'labels' });
      const result = await postAction('/api/repositories/labels', { repo, ...change });
      receive(result);
      set({ running: null, labelChanges: get().labelChanges + (result.error ? 0 : 1) });
      return result.error ?? null;
    },
  };
});
