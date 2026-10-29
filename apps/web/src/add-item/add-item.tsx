// The title bar's Add item button and its dialog: a form that creates an issue in a configured repo
// and adds it to List. ⌘N opens it too. The store keeps the form's values as they're edited, so a half-written draft
// survives a close. A large title and the description editor sit on the left; the side panel holds the repository, the
// kind, Only for <repo> on an Azure repository, and the custom labels by Label group.

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, SquarePen } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { ITEM_KINDS, noneOnboarded, onAzure, repoName } from '@lar-factory/shared';
import type { RepoConfig } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Fieldset } from '@lar-factory/ui/fieldset';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { FormResult } from '../notices/form-result.tsx';
import { itemNoun, useAddItemStore } from './add-item-store.ts';
import type { DraftValues, ResultMessage } from './add-item-store.ts';
import { labelGroups } from './label-groups.ts';
import { useBoardStore } from '../board/board-store.ts';
import { AddingARepository } from '../notices/adding-a-repository.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { DescriptionEditor } from '../description-editor/description-editor.tsx';
import { EXPANDED, ExpandButton, useExpand } from '../expand-dialog/expand-dialog.tsx';

const SMALL_HEADING = 'm-0 text-[11px] font-medium uppercase tracking-wider text-(--muted-foreground)';
const HINT = 'm-0 text-xs leading-snug text-(--muted-foreground)';

/** A side panel section under a small uppercase heading, which labels the field `htmlFor` names. */
function PanelSection({ heading, htmlFor, children }: { heading: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className={SMALL_HEADING}>{heading}</label>
      {children}
    </div>
  );
}

/** The repo's custom labels, or tags on Azure DevOps, as toggle chips by Label group, none when it has none; `picked`
 *  start ticked. Clear unticks them all, then `onClear` lets the form keep its values. */
function CustomLabels({ repo, picked, onClear }: { repo: RepoConfig; picked: readonly string[]; onClear: () => void }) {
  const [ticked, setTicked] = useState(picked);
  if (!repo.labels.length) return null;
  const groups = labelGroups(repo.labels);
  const clear = () => {
    flushSync(() => setTicked([]));
    onClear();
  };
  return (
    <Fieldset unstyled className="custom-labels relative grid gap-3">
      <legend className="float-left m-0 p-0 text-xs font-medium text-base-content">{onAzure(repo.repo) ? 'Tags' : 'Labels'}</legend>
      {ticked.length > 0 && <button type="button" onClick={clear}
        className="absolute end-0 top-0 rounded-sm text-xs text-(--muted-foreground) outline-none hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary">Clear</button>}
      {groups.map(({ heading, prefix, options }) => (
        <div key={prefix === null ? 'unprefixed' : `prefix-${prefix}`} role="group" aria-label={heading} className="grid gap-1.5">
          <span aria-hidden className={SMALL_HEADING}>{heading}</span>
          <div className="flex flex-wrap gap-1.5">
            {options.map(({ label, text }) => {
              const on = ticked.includes(label);
              return (
                <label key={label} className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs transition-colors has-focus-visible:ring-2 has-focus-visible:ring-primary has-disabled:cursor-default has-disabled:opacity-60 ${on ? 'border-primary/60 bg-primary/8 text-primary' : 'border-base-300 bg-base-100 text-base-700 hover:border-base-400 hover:text-base-content'}`}>
                  <input type="checkbox" name="labels" value={label} checked={on} className="sr-only"
                    onChange={(event) => setTicked(event.currentTarget.checked ? [...ticked, label] : ticked.filter((each) => each !== label))} />
                  {on && <Check aria-hidden className="-ms-0.5 size-3" />}{text}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </Fieldset>
  );
}

/** Only for <repo> on an Azure repository: unticked, the new work item shows in every List that reads its item source. */
function OnlyFor({ repo, name, ticked }: { repo: RepoConfig; name: string; ticked: boolean }) {
  if (repo.items !== 'azure-board') return null;
  return (
    <div className="grid gap-1 pt-1">
      <Checkbox name="onlyFor" value="true" label={`Only for ${name}`} defaultChecked={ticked} aria-describedby="item-only-for-hint" />
      <p className={`${HINT} ps-6`} id="item-only-for-hint">Unticked, it appears for every repository that reads the {repo.team} team's backlog and current sprint.</p>
    </div>
  );
}

/** The form's values and the editor's `description`, for the store to keep. */
function valuesOf(form: HTMLFormElement, description: string): DraftValues {
  const values = new FormData(form);
  const value = (name: string) => String(values.get(name) ?? '');
  return { repo: value('repo'), kind: value('kind'), title: value('title'), description,
    labels: values.getAll('labels').map(String), onlyFor: values.get('onlyFor') === 'true' };
}

function Result({ message }: { message: ResultMessage }) {
  return (
    <FormResult id="item-result" text={message.text}>
      {message.url && <a href={message.url} target="_blank" rel="noopener">{message.label}</a>}
    </FormResult>
  );
}

function AddItemForm() {
  const data = useBoardStore((state) => state.data);
  const { submission, message, submit, edit, keep, reset, setOpen } = useAddItemStore();
  // Read once: the fields are uncontrolled and start from the kept draft.
  const [kept] = useState(() => useAddItemStore.getState().values);
  const [repo, setRepo] = useState(kept?.repo ?? data.repos[0]?.repo ?? '');
  const form = useRef<HTMLFormElement>(null);
  // The editor is no form field, so its Markdown is kept here.
  const description = useRef(kept?.description ?? '');
  const { phase } = submission;
  const locked = phase !== 'editing';
  // Opened before the repositories arrived, repo matches none: the select then shows the first.
  const selected = data.repos.find((r) => r.repo === repo) ?? data.repos[0];
  const hint = noneOnboarded(data);
  const keepForm = () => keep(valuesOf(form.current!, description.current));
  // An edit in the editor counts as one in the form.
  const onDescription = (markdown: string) => {
    description.current = markdown;
    edit();
    keepForm();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void submit({ repo: values.get('repo'), kind: values.get('kind'), title: values.get('title'),
      description: description.current, labels: values.getAll('labels'), onlyFor: values.get('onlyFor') === 'true' }).then(() => {
      if (useAddItemStore.getState().submission.phase === 'editing' && form.isConnected) form.reportValidity();
    });
  };
  return (
    <Modal.Form ref={form} id="add-item-form" noValidate aria-busy={phase === 'pending'} onSubmit={onSubmit} onInput={edit} onChange={keepForm}>
      {/* Narrower than 40rem, the side panel stacks under the editor and the two scroll as one. */}
      <div className="@container flex min-h-0 flex-1 flex-col">
        <Fieldset id="item-fields" unstyled disabled={locked}
          className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_16rem] border-t border-base-300 @max-[40rem]:grid-cols-[minmax(0,1fr)] @max-[40rem]:content-start @max-[40rem]:overflow-y-auto">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5 pt-4 sm:px-6 @max-[40rem]:min-h-80 @max-[40rem]:overflow-visible">
            <input id="item-title" name="title" required maxLength={256} autoComplete="off" defaultValue={kept?.title} aria-label="Title" placeholder="Title"
              className="w-full shrink-0 border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-base-content outline-none placeholder:font-medium placeholder:text-(--muted-foreground)" />
            <DescriptionEditor label="Description" placeholder="Add a description… - for a list, 1. for steps, # for a heading"
              value={kept?.description ?? ''} onChange={onDescription} disabled={locked} fill />
            <Result message={message} />
          </div>
          <aside aria-label="Details" className="grid content-start gap-5 overflow-y-auto border-l border-base-300 bg-base-50/60 px-4 py-4 @max-[40rem]:overflow-visible @max-[40rem]:border-l-0 @max-[40rem]:border-t">
            <PanelSection heading="Repository" htmlFor="item-repo">
              {/* Uncontrolled and read on input: the form's onInput re-renders before the select's change
                  event, and a controlled select would be set back to the old repo. */}
              <NativeSelect id="item-repo" name="repo" required defaultValue={repo} onInput={(event) => setRepo(event.currentTarget.value)}
                aria-describedby={hint ? 'item-repo-hint' : undefined}>
                {data.repos.map((r) => <option value={r.repo} key={r.repo}>{repoName(r.repo, data.repos)}</option>)}
              </NativeSelect>
              {hint && <p className={HINT} id="item-repo-hint">No repository is onboarded. <AddingARepository /></p>}
              {selected && <OnlyFor repo={selected} name={repoName(selected.repo, data.repos)} ticked={selected.repo === kept?.repo && kept.onlyFor}
                key={`only-${selected.repo}`} />}
            </PanelSection>
            <PanelSection heading="Kind" htmlFor="item-kind">
              <NativeSelect id="item-kind" name="kind" required defaultValue={kept?.kind ?? ''}>
                <option value="">Choose a kind</option>
                {ITEM_KINDS.map((kind) => <option value={kind} key={kind}>{kind}</option>)}
              </NativeSelect>
            </PanelSection>
            {/* Keyed by repo, so another repo's labels start unchecked. */}
            {selected?.labels.length ? <>
              <div className="h-px bg-base-300/70" />
              <CustomLabels repo={selected} picked={selected.repo === kept?.repo ? kept.labels : []} onClear={() => { edit(); keepForm(); }} key={selected.repo} />
            </> : null}
          </aside>
        </Fieldset>
      </div>
      <Modal.Footer leading={<span className="text-xs text-(--muted-foreground)">Formats as you type · saved as Markdown</span>}>
        <Button {...kind('other')} id="item-new" hidden={phase !== 'uncertain'} onClick={reset}>New item</Button>
        <Button {...kind('other')} onClick={() => setOpen(false)}>Cancel</Button>
        <Button {...kind('main')} type="submit" id="item-submit"
          disabled={phase === 'pending' || phase === 'uncertain' || data.capture?.enabled === false || !data.repos.length}>
          {phase === 'pending' ? 'Adding…' : phase === 'retry' ? 'Retry this submission' : 'Add to List'}
        </Button>
      </Modal.Footer>
    </Modal.Form>
  );
}

/** What the dialog creates, in the repository the form has picked: the kept draft's, else the first. */
function useDescription(): string {
  const repos = useBoardStore((state) => state.data.repos);
  const picked = useAddItemStore((state) => state.values?.repo);
  const selected = repos.find((r) => r.repo === picked) ?? repos[0];
  return `Create ${itemNoun(selected?.repo) === 'issue' ? 'an issue' : 'a work item'}${selected ? ` in ${repoName(selected.repo, repos)}` : ''} and add it to List.`;
}

/** The open dialog; each opening starts at the normal size. */
function AddItemDialog() {
  const { draft, setOpen } = useAddItemStore();
  const [expanded, toggleExpanded] = useExpand();
  const description = useDescription();
  return (
    <Modal onClose={() => setOpen(false)}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so a hidden copy of it describes the dialog. */}
      <Modal.Content id="add-item-dialog" title="Add item" description={description} aria-describedby="add-item-description"
        presentation="paned" style={expanded ? EXPANDED : undefined} headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />}>
        <span id="add-item-description" hidden>{description}</span>
        {/* A new draft remounts the form, which clears its fields. */}
        <AddItemForm key={draft} />
      </Modal.Content>
    </Modal>
  );
}

export function AddItem() {
  const { open, setOpen } = useAddItemStore();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        useAddItemStore.getState().setOpen(true);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (<>
    <Button {...kind('main')} className="add-item px-2" leftIcon={<SquarePen />} title="Add item (⌘N)" aria-keyshortcuts="Meta+N"
      onClick={() => setOpen(true)}><span className="@max-[70rem]:sr-only">Add item</span></Button>
    {open && <AddItemDialog />}
  </>);
}
