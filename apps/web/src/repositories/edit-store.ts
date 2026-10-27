// Edit in Settings › Repositories: the onboarded repository it edits, its .lar-factory.json values and labels as the
// server reads them from its open Edit PR's branch or else the default branch, and the answers the user gives in
// onboarding's setup fields and custom label picker. Add only picks a typed label; Save asks the server to create the
// custom labels the repository lacks and open the PR on .lar-factory.json, or add to the open one, keeping the dialog
// and its answers open with gh's message when that fails.

import { create } from 'zustand';
import { customLabelChoices, labelPlan, shownRepo, type RepositoryConfigAnswers, type SetupAnswers } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import { showPrToast } from '../notices/toasts.tsx';
import { answerSetup, setupItemSource, setupProblems, type SetupChange } from '../onboarding/setup-answers.ts';

/** The answers Edit starts from: the file's values, with its show setting picked, so a new item source keeps it. */
function setupOf(repo: string, { itemSource, show, role }: RepositoryConfigAnswers): SetupAnswers {
  const project = itemSource.kind === 'github-project' ? { projectOwner: itemSource.owner, projectNumber: String(itemSource.number) }
    : { projectOwner: repo.split('/')[0] ?? '', projectNumber: '' };
  return { itemSource: itemSource.kind, ...project, ...'team' in itemSource && { team: itemSource.team }, show, showPicked: true, role };
}

/** The editing form, once the repository's values loaded. */
export interface EditForm {
  /** The values the file has, on the open Edit PR's branch or else the default branch, which Save compares against. */
  loaded: RepositoryConfigAnswers;
  /** The URL of the open Edit PR whose branch the values come from; null when they come from the default branch. */
  editPr: string | null;
  /** The repository's labels a custom label can be. */
  offered: string[];
  setup: SetupAnswers;
  picked: string[];
  typed: string;
  saving: boolean;
  /** Why the last Save failed, with gh's message. */
  error: string | null;
}

interface Edit {
  repo: string;
  form: { state: 'loading' } | { state: 'failed'; error: string } | ({ state: 'loaded' } & EditForm);
}

/** The .lar-factory.json values the form saves; null while a field has a problem. */
function configOf(form: EditForm): RepositoryConfigAnswers | null {
  if (Object.keys(setupProblems(form.setup, 'Save')).length) return null;
  return { itemSource: setupItemSource(form.setup), show: form.setup.show, role: form.setup.role.trim(), labels: form.picked };
}

/** Whether every field is fine and each value is the loaded file's, so Save has nothing to send. */
export function unchanged(form: EditForm): boolean {
  const config = configOf(form);
  return !!config && JSON.stringify(config) === JSON.stringify(form.loaded);
}

/** Whether Save can go: no field has a problem, a value differs from the loaded file's, and no Save is running. */
export function canSave(form: EditForm): boolean {
  return !!configOf(form) && !form.saving && !unchanged(form);
}

interface EditState {
  edit: Edit | null;
  open: (repo: string) => Promise<void>;
  close: () => void;
  retry: () => Promise<void>;
  answer: (change: SetupChange) => void;
  toggle: (name: string) => void;
  type: (typed: string) => void;
  add: () => void;
  save: () => Promise<void>;
}

export const useEditStore = create<EditState>()((set, get) => {
  /** The loaded form of `repo`'s Edit, while it is still the one open. */
  const formOf = (repo: string) => {
    const { edit } = get();
    return edit?.repo === repo && edit.form.state === 'loaded' ? edit.form : null;
  };
  const change = (patch: (form: EditForm) => Partial<EditForm>) => {
    const { edit } = get();
    if (edit?.form.state === 'loaded') set({ edit: { ...edit, form: { ...edit.form, ...patch(edit.form) } } });
  };
  const load = async (repo: string) => {
    set({ edit: { repo, form: { state: 'loading' } } });
    const read = await postAction<{ config: RepositoryConfigAnswers; labels: string[]; editPr?: string }>('/api/repositories/config', { repo });
    if (get().edit?.repo !== repo) return;
    if (!read.config || !read.labels) return set({ edit: { repo, form: { state: 'failed', error: read.error ?? 'The board sent no Repository config.' } } });
    const { config, labels } = read;
    set({ edit: { repo, form: {
      state: 'loaded', loaded: config, editPr: read.editPr ?? null, offered: customLabelChoices(labelPlan(labels, config.itemSource.kind)), setup: setupOf(repo, config),
      picked: config.labels, typed: '', saving: false, error: null,
    } } });
  };
  return {
    edit: null,
    open: (repo) => load(repo),
    // A Save that is running keeps the dialog, and its answers, open until it answers.
    close: () => {
      const { edit } = get();
      if (edit?.form.state !== 'loaded' || !edit.form.saving) set({ edit: null });
    },
    retry: async () => {
      const { edit } = get();
      if (edit) await load(edit.repo);
    },
    // A Save that is running holds the answers it sends.
    answer: (setup) => change((form) => form.saving ? {} : { setup: answerSetup(form.setup, setup) }),
    toggle: (name) => change((form) => form.saving ? {} : { picked: form.picked.includes(name) ? form.picked.filter((n) => n !== name) : [...form.picked, name] }),
    type: (typed) => change(() => ({ typed })),
    // A label the repository has, or one picked already, under another case, is picked under its own name.
    add: () => change((form) => {
      const typed = form.typed.trim();
      const same = (name: string) => name.toLowerCase() === typed.toLowerCase();
      const name = form.offered.find(same) ?? form.picked.find(same) ?? typed;
      return { typed: '', picked: form.picked.includes(name) ? form.picked : [...form.picked, name] };
    }),
    save: async () => {
      const { edit } = get();
      if (edit?.form.state !== 'loaded' || !canSave(edit.form)) return;
      const { repo, form: { editPr } } = edit;
      change(() => ({ saving: true, error: null }));
      const opened = await postAction<{ prUrl: string }>('/api/repositories/config/pr', { repo, config: configOf(edit.form) });
      if (!formOf(repo)) return;
      if (!opened.prUrl) return change(() => ({ saving: false, error: opened.error ?? 'The board sent no PR.' }));
      // The board sent back shows the Edit PR on the repository's row.
      receive(opened);
      set({ edit: null });
      showPrToast({ slot: 'edit', what: ` Edit PR for ${shownRepo(repo)}`, prUrl: opened.prUrl, label: `${shownRepo(repo)}’s Edit PR`,
        ...editPr ? { before: 'Added the new values to ' } : { after: '. The board keeps the current values until it merges.' } });
    },
  };
});
