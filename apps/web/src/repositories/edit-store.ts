// Local repository settings, edited from Settings.
import { create } from 'zustand';
import { type RepositorySetup, type SharedRepositorySettings, type SharedSetting, type TrackerLabel, type VocabularyKey, type VocabularyTerm } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import type { IssueSetting } from './issue-defaults.tsx';

/** Settings whose editor uses text drafts. Vocabulary saves one complete term at a time. */
export type DraftSetting = Exclude<SharedSetting, 'labels' | 'vocabulary' | 'createIssuesFromAddItem' | 'createIssuesFromRetro' | 'writeRefinedSpec'>;

/** Project fields that keep text drafts until their save succeeds. */
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
function valueOf(key: DraftSetting, drafts: Drafts): SharedRepositorySettings[SharedSetting] | null {
  switch (key) {
    case 'role': return drafts.role.trim();
    case 'itemSource': return drafts.team.trim() ? { kind: 'azure-board', team: drafts.team.trim() } : null;
    case 'skills': return list(drafts.skills);
    case 'domainDocs':
      if (drafts.domainDocs === 'off') return { kind: 'off' };
      return drafts.glossary.trim() && drafts.adrs.trim() ? { kind: 'repository', glossary: drafts.glossary.trim(), adrs: drafts.adrs.trim() } : null;
  }
}

/** One change to the tracker's labels, as the Labels section sends it. */
export type LabelChange = { change: 'create'; name: string } | { change: 'update'; name: string; update: Partial<TrackerLabel> } | { change: 'delete'; name: string };

/** A setting write, label change or access check. */
type Running = SharedSetting | 'recheck';

interface VocabularyDraft { value: VocabularyTerm; newLabels: string[] }
interface EditState {
  issueDrafts: Record<string, Partial<Record<IssueSetting, boolean>>>;
  vocabularyDrafts: Record<string, Partial<Record<VocabularyKey, VocabularyDraft>>>;
  vocabularyErrors: Record<string, Partial<Record<VocabularyKey, string>>>;
  draftVocabulary: (repo: string, key: VocabularyKey, value: VocabularyTerm, newLabels: string[]) => void;
  drafts: Record<string, Partial<Drafts>>;
  fieldErrors: Record<string, Partial<Record<keyof Drafts | Running, string>>>;
  running: Running | null;
  /** Why the last call failed, by the repository it was for. */
  errors: Record<string, string>;
  /** Successful writes and access checks that require fresh vocabulary discovery. */
  labelChanges: number;
  type: (repo: string, field: keyof Drafts, text: string) => void;
  save: (repo: string, key: DraftSetting, setup: RepositorySetup) => Promise<void>;
  reset: (repo: string, key: DraftSetting) => Promise<void>;
  recheck: (repo: string) => Promise<void>;
  vocabulary: (repo: string, key: VocabularyKey, value: VocabularyTerm, newLabels: string[]) => Promise<boolean>;
  issueDefault: (repo: string, key: IssueSetting, on: boolean) => Promise<void>;
  /** Sends a label change to the tracker; the reason it failed, or null. */
  labels: (repo: string, change: LabelChange) => Promise<string | null>;
}

export const useEditStore = create<EditState>()((set, get) => {
  const queues = new Map<string, { id: string; task: Promise<string | null> }>();
  const choiceVersions: Record<string, Partial<Record<IssueSetting, number>>> = {};
  const revisions: Record<string, Partial<Record<keyof Drafts, number>>> = {};
  const fieldError = (repo: string, field: keyof Drafts | Running, error: string | null) => {
    const errors = { ...get().fieldErrors[repo] };
    if (error) errors[field] = error;
    else delete errors[field];
    set({ fieldErrors: { ...get().fieldErrors, [repo]: errors } });
  };
  function call(repo: string, running: Running, change: object, snapshot?: Partial<Drafts>, endpoint = '/api/repositories/settings'): Promise<string | null> {
    const versions = Object.fromEntries((Object.keys(snapshot ?? {}) as (keyof Drafts)[]).map((field) => [field, revisions[repo]?.[field]]));
    const id = JSON.stringify([repo, change, versions]);
    const waiting = queues.get(repo);
    if (waiting?.id === id) return waiting.task;
    const task = (waiting?.task ?? Promise.resolve()).then(async () => {
      set({ running });
      fieldError(repo, running, null);
      const result = await postAction(endpoint, { repo, ...change });
      receive(result);
      if (result.error) fieldError(repo, running, result.error);
      else if (snapshot) {
        const typed = { ...get().drafts[repo] };
        for (const field of Object.keys(snapshot) as (keyof Drafts)[]) {
          if (revisions[repo]?.[field] === versions[field]) delete typed[field];
        }
        set({ drafts: { ...get().drafts, [repo]: typed } });
      }
      const errors = { ...get().errors };
      if (result.error) errors[repo] = result.error;
      else delete errors[repo];
      set({ running: null, errors, labelChanges: get().labelChanges + (!result.error && (running === 'labels' || running === 'vocabulary' || running === 'recheck') ? 1 : 0) });
      return result.error;
    }).finally(() => {
      if (queues.get(repo)?.task === task) queues.delete(repo);
    });
    queues.set(repo, { id, task });
    return task;
  }
  return {
    issueDrafts: {}, vocabularyDrafts: {}, vocabularyErrors: {},
    draftVocabulary: (repo, key, value, newLabels) => set({ vocabularyDrafts: { ...get().vocabularyDrafts, [repo]: { ...get().vocabularyDrafts[repo], [key]: { value, newLabels } } } }),
    drafts: {}, fieldErrors: {}, running: null, errors: {}, labelChanges: 0,
    type: (repo, field, text) => {
      revisions[repo] = { ...revisions[repo], [field]: (revisions[repo]?.[field] ?? 0) + 1 };
      set({ drafts: { ...get().drafts, [repo]: { ...get().drafts[repo], [field]: text } } });
      fieldError(repo, field, null);
    },
    save: async (repo, key, setup) => {
      const typed = get().drafts[repo] ?? {};
      if (!FIELDS[key].some((field) => field in typed)) return;
      const drafts = shownDrafts(setup, typed);
      const value = valueOf(key, drafts);
      if (value === null) {
        if (key === 'itemSource') fieldError(repo, 'team', 'Enter a Team.');
        if (key === 'domainDocs') {
          if (!drafts.glossary.trim()) fieldError(repo, 'glossary', 'Enter a glossary path.');
          if (!drafts.adrs.trim()) fieldError(repo, 'adrs', 'Enter an ADR folder.');
        }
        return;
      }
      const snapshot = Object.fromEntries(FIELDS[key].filter((field) => field in typed).map((field) => [field, typed[field]]));
      await call(repo, key, { change: 'override', key, value }, snapshot);
    },
    reset: async (repo, key) => {
      const typed = get().drafts[repo] ?? {};
      const snapshot = Object.fromEntries(FIELDS[key].filter((field) => field in typed).map((field) => [field, typed[field]]));
      await call(repo, key, { change: 'override', key }, snapshot);
    },
    recheck: async (repo) => { await call(repo, 'recheck', { change: 'recheck' }); },
    vocabulary: async (repo, key, value, newLabels) => {
      const snapshot = get().vocabularyDrafts[repo]?.[key];
      const error = await call(repo, 'vocabulary', { change: 'vocabulary', key, value, ...newLabels.length && { newLabels } });
      set({ vocabularyErrors: { ...get().vocabularyErrors, [repo]: { ...get().vocabularyErrors[repo], [key]: error ?? undefined } } });
      if (!error && get().vocabularyDrafts[repo]?.[key] === snapshot) {
        const drafts = { ...get().vocabularyDrafts[repo] };
        delete drafts[key];
        set({ vocabularyDrafts: { ...get().vocabularyDrafts, [repo]: drafts } });
      }
      return !error;
    },
    issueDefault: async (repo, key, on) => {
      const version = (choiceVersions[repo]?.[key] ?? 0) + 1;
      choiceVersions[repo] = { ...choiceVersions[repo], [key]: version };
      set({ issueDrafts: { ...get().issueDrafts, [repo]: { ...get().issueDrafts[repo], [key]: on } } });
      const error = await call(repo, key, { change: 'override', key, value: on });
      if (!error && choiceVersions[repo]?.[key] === version) {
        const draft = { ...get().issueDrafts[repo] };
        delete draft[key];
        set({ issueDrafts: { ...get().issueDrafts, [repo]: draft } });
      }
    },
    labels: (repo, change) => call(repo, 'labels', change, undefined, '/api/repositories/labels'),
  };
});
