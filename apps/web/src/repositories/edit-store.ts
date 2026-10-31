// Edit in Settings › Repositories: the onboarded repository whose settings it edits, and the text the user typed for
// each setting. The setup itself comes from the board, so the dialog shows the latest read. Save posts one setting as a
// local override, Use shared default removes it, Recheck access forgets what the credentials allowed, Offer sets the
// operations offered, and Accept, on the repository's row, accepts a changed item source or domain-doc location. The
// board sent back shows each change.

import { create } from 'zustand';
import { REPOSITORY_OPERATIONS, type RepositoryOperation, type RepositorySetup, type SharedRepositorySettings, type SharedSetting } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';

/** The text of each field the dialog edits, by field. */
export interface Drafts {
  role: string;
  team: string;
  labels: string;
  skills: string;
  /** `private` or `repository`. */
  domainDocs: string;
  glossary: string;
  adrs: string;
}

/** The fields that make each setting's value. */
const FIELDS: Record<SharedSetting, (keyof Drafts)[]> = {
  role: ['role'], itemSource: ['team'], labels: ['labels'], skills: ['skills'], domainDocs: ['domainDocs', 'glossary', 'adrs'],
};

/** The fields' text for the setup's values; a repository's own domain docs start at the usual paths. */
function draftsOf(setup: RepositorySetup): Drafts {
  const docs = setup.domainDocs.kind === 'repository' ? setup.domainDocs : { kind: 'private', glossary: 'GLOSSARY.md', adrs: 'docs/adr' };
  return { role: setup.role, team: setup.itemSource?.kind === 'azure-board' ? setup.itemSource.team : '',
    labels: setup.labels.join(', '), skills: setup.skills.join(', '), domainDocs: docs.kind, glossary: docs.glossary, adrs: docs.adrs };
}

const list = (text: string) => text.split(',').map((part) => part.trim()).filter(Boolean);

/** The fields' text, typed or else from the setup. */
export const shownDrafts = (setup: RepositorySetup, typed: Partial<Drafts>): Drafts => ({ ...draftsOf(setup), ...typed });

/** The value `key`'s fields make, or null while one is empty that the value needs. */
export function valueOf(key: SharedSetting, drafts: Drafts): SharedRepositorySettings[SharedSetting] | null {
  switch (key) {
    case 'role': return drafts.role.trim();
    case 'itemSource': return drafts.team.trim() ? { kind: 'azure-board', team: drafts.team.trim() } : null;
    case 'labels': return list(drafts.labels);
    case 'skills': return list(drafts.skills);
    case 'domainDocs':
      if (drafts.domainDocs === 'private') return { kind: 'private' };
      return drafts.glossary.trim() && drafts.adrs.trim() ? { kind: 'repository', glossary: drafts.glossary.trim(), adrs: drafts.adrs.trim() } : null;
  }
}

/** Whether `key`'s fields make a value other than the setup's, so Save has something to set. */
export function canSave(key: SharedSetting, setup: RepositorySetup, typed: Partial<Drafts>): boolean {
  const value = valueOf(key, shownDrafts(setup, typed));
  return value !== null && JSON.stringify(value) !== JSON.stringify(setup[key]);
}

/** A call to the board: one setting's Save or removal, Recheck access, Offer, or Accept. */
type Running = SharedSetting | 'recheck' | 'consent' | 'accept';

interface EditState {
  /** The repository whose dialog is open. */
  repo: string | null;
  typed: Partial<Drafts>;
  running: Running | null;
  /** Why the last call failed, by the repository it was for. */
  errors: Record<string, string>;
  open: (repo: string) => void;
  close: () => void;
  type: (field: keyof Drafts, text: string) => void;
  save: (repo: string, key: SharedSetting, setup: RepositorySetup) => Promise<void>;
  useShared: (repo: string, key: SharedSetting) => Promise<void>;
  recheck: (repo: string) => Promise<void>;
  /** Offers `op` or stops offering it, keeping the other operations the setup offers. */
  offer: (repo: string, op: RepositoryOperation, on: boolean, setup: RepositorySetup) => Promise<void>;
  accept: (repo: string) => Promise<void>;
}

export const useEditStore = create<EditState>()((set, get) => {
  /** Posts the change for `repo`; once it lands, `key`'s typed text gives way to the setup the board sent back. */
  async function call(repo: string, running: Running, change: object, key?: SharedSetting): Promise<void> {
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
    repo: null, typed: {}, running: null, errors: {},
    open: (repo) => set({ repo, typed: {} }),
    // A call that is running keeps the dialog open until it answers.
    close: () => { if (!get().running) set({ repo: null, typed: {} }); },
    type: (field, text) => set({ typed: { ...get().typed, [field]: text } }),
    save: (repo, key, setup) => {
      const value = valueOf(key, shownDrafts(setup, get().typed));
      return value === null ? Promise.resolve() : call(repo, key, { change: 'override', key, value }, key);
    },
    useShared: (repo, key) => call(repo, key, { change: 'override', key }, key),
    recheck: (repo) => call(repo, 'recheck', { change: 'recheck' }),
    offer: (repo, op, on, setup) => call(repo, 'consent', { change: 'consent',
      value: REPOSITORY_OPERATIONS.filter((o) => (o === op ? on : setup.consent.includes(o))) }),
    accept: (repo) => call(repo, 'accept', { change: 'accept' }),
  };
});
