// The title bar's Add item button and its dialog, in two panes. New work is a form that records work in an onboarded
// repository and adds it to List, creating no ticket: a large title and the description editor on the left, the
// repository and kind in the side panel. Pick a ticket searches a repository's open tickets and records the one picked.
// ⌘N opens it too. The store keeps the form's values as they're edited, so a half-written draft survives a close.

import { useEffect, useRef, useState } from 'react';
import { SquarePen } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { ITEM_KINDS, noneOnboarded, repoName } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Fieldset } from '@lar-factory/ui/fieldset';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { FormResult } from '../notices/form-result.tsx';
import { useAddItemStore } from './add-item-store.ts';
import type { AddItemPane, DraftValues } from './add-item-store.ts';
import { TicketPicker } from './ticket-picker.tsx';
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

/** The form's values and the editor's `description`, for the store to keep. */
function valuesOf(form: HTMLFormElement, description: string): DraftValues {
  const values = new FormData(form);
  const value = (name: string) => String(values.get(name) ?? '');
  return { repo: value('repo'), kind: value('kind'), title: value('title'), description };
}

/** The repository select both panes start with, and the hint when none is onboarded. */
function RepoSelect({ id, repo, onRepo }: { id: string; repo: string; onRepo?: (repo: string) => void }) {
  const data = useBoardStore((state) => state.data);
  const hint = noneOnboarded(data);
  return (<>
    {/* Uncontrolled and read on input: the form's onInput re-renders before the select's change
        event, and a controlled select would be set back to the old repo. */}
    <NativeSelect id={id} name="repo" required defaultValue={repo} onInput={(event) => onRepo?.(event.currentTarget.value)}
      aria-describedby={hint ? `${id}-hint` : undefined}>
      {data.repos.map((r) => <option value={r.repo} key={r.repo}>{repoName(r.repo, data.repos)}</option>)}
    </NativeSelect>
    {hint && <p className={HINT} id={`${id}-hint`}>No repository is onboarded. <AddingARepository /></p>}
  </>);
}

function AddItemForm() {
  const data = useBoardStore((state) => state.data);
  const { submission, message, submit, edit, keep, reset, setOpen } = useAddItemStore();
  // Read once: the fields are uncontrolled and start from the kept draft.
  const [kept] = useState(() => useAddItemStore.getState().values);
  const form = useRef<HTMLFormElement>(null);
  // The editor is no form field, so its Markdown is kept here.
  const description = useRef(kept?.description ?? '');
  const { phase } = submission;
  const locked = phase !== 'editing';
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
    void submit({ repo: values.get('repo'), kind: values.get('kind'), title: values.get('title'), description: description.current }).then(() => {
      if (useAddItemStore.getState().submission.phase === 'editing' && form.isConnected) form.reportValidity();
    });
  };
  return (
    <Modal.Form ref={form} id="add-item-form" noValidate aria-busy={phase === 'pending'} onSubmit={onSubmit} onInput={edit} onChange={keepForm}>
      {/* Narrower than 40rem, the side panel stacks under the editor, which grows with its text, and the two scroll as one;
          each row sizes to its content, so a long text pushes the panel down rather than running under it. */}
      <div className="@container flex min-h-0 flex-1 flex-col">
        <Fieldset id="item-fields" unstyled disabled={locked}
          className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_16rem] border-t border-base-300 @max-[40rem]:grid-cols-[minmax(0,1fr)] @max-[40rem]:auto-rows-max @max-[40rem]:content-start @max-[40rem]:overflow-y-auto">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5 pt-4 sm:px-6 @max-[40rem]:min-h-80 @max-[40rem]:overflow-visible">
            <input id="item-title" name="title" required maxLength={256} autoComplete="off" defaultValue={kept?.title} aria-label="Title" placeholder="Title"
              className="w-full shrink-0 border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-base-content outline-none placeholder:font-medium placeholder:text-(--muted-foreground)" />
            <DescriptionEditor label="Description" placeholder="Add a description… - for a list, 1. for steps, # for a heading"
              value={kept?.description ?? ''} onChange={onDescription} disabled={locked} fill="wide" />
            <FormResult id="item-result" text={message} />
          </div>
          <aside aria-label="Details" className="grid content-start gap-5 overflow-y-auto border-l border-base-300 bg-base-50/60 px-4 py-4 @max-[40rem]:overflow-visible @max-[40rem]:border-l-0 @max-[40rem]:border-t">
            <PanelSection heading="Repository" htmlFor="item-repo">
              <RepoSelect id="item-repo" repo={kept?.repo ?? data.repos[0]?.repo ?? ''} />
            </PanelSection>
            <PanelSection heading="Kind" htmlFor="item-kind">
              <NativeSelect id="item-kind" name="kind" required defaultValue={kept?.kind ?? ''}>
                <option value="">Choose a kind</option>
                {ITEM_KINDS.map((kind) => <option value={kind} key={kind}>{kind}</option>)}
              </NativeSelect>
            </PanelSection>
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

/** Pick a ticket: the repository, then the ticket picker for it. Picking closes the dialog. */
function PickTicketPane() {
  const data = useBoardStore((state) => state.data);
  const { pick, setOpen } = useAddItemStore();
  const [repo, setRepo] = useState(() => useAddItemStore.getState().values?.repo ?? data.repos[0]?.repo ?? '');
  // Opened before the repositories arrived, repo matches none: the select then shows the first.
  const selected = data.repos.find((r) => r.repo === repo) ?? data.repos[0];
  const disabled = data.capture?.enabled === false || !selected;
  return (<>
    <div className="grid min-h-0 content-start gap-4 overflow-y-auto border-t border-base-300 px-5 pb-5 pt-4 sm:px-6" id="pick-ticket">
      <PanelSection heading="Repository" htmlFor="pick-repo">
        <RepoSelect id="pick-repo" repo={repo} onRepo={setRepo} />
      </PanelSection>
      <TicketPicker id="pick" repo={selected?.repo ?? ''} disabled={disabled} key={selected?.repo} onPick={(ticket) => pick(selected!.repo, ticket)} />
      {data.capture?.enabled === false && <p className={HINT}>Picking tickets is disabled in sample mode.</p>}
    </div>
    <Modal.Footer>
      <Button {...kind('other')} onClick={() => setOpen(false)}>Cancel</Button>
    </Modal.Footer>
  </>);
}

/** New work or Pick a ticket, as two buttons, the shown pane's pressed. */
function PaneSwitch() {
  const { pane, setPane } = useAddItemStore();
  const choice = (to: AddItemPane, label: string) => (
    <button type="button" data-pane={to} aria-pressed={pane === to} onClick={() => setPane(to)}
      className={`h-7 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${pane === to ? 'bg-base-100 text-base-content shadow-sm' : 'text-(--muted-foreground) hover:text-base-content'}`}>{label}</button>
  );
  return (
    <div role="group" aria-label="Add" className="flex gap-0.5 rounded-lg bg-base-200 p-0.5">
      {choice('new', 'New work')}{choice('pick', 'Pick a ticket')}
    </div>
  );
}

/** What the shown pane does, in the repository the form has picked: the kept draft's, else the first. */
function useDescription(): string {
  const repos = useBoardStore((state) => state.data.repos);
  const { pane, values } = useAddItemStore();
  const selected = repos.find((r) => r.repo === values?.repo) ?? repos[0];
  const where = selected ? ` in ${repoName(selected.repo, repos)}` : '';
  return pane === 'pick' ? `Pick an open ticket${where} and add it to List.` : `Record work${where} and add it to List.`;
}

/** Pick a ticket's pane is short, so the dialog keeps its width but takes the pane's height; a long result list scrolls inside it. */
const FITS_CONTENT = { height: 'auto' };

/** The open dialog; each opening starts at the normal size. */
function AddItemDialog() {
  const { draft, pane, setOpen } = useAddItemStore();
  const [expanded, toggleExpanded] = useExpand();
  const description = useDescription();
  return (
    <Modal onClose={() => setOpen(false)}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so a hidden copy of it describes the dialog. */}
      <Modal.Content id="add-item-dialog" title="Add item" description={description} aria-describedby="add-item-description"
        presentation="paned" style={expanded ? EXPANDED : pane === 'pick' ? FITS_CONTENT : undefined} headerActions={<><PaneSwitch /><ExpandButton expanded={expanded} toggle={toggleExpanded} /></>}>
        <span id="add-item-description" hidden>{description}</span>
        {/* A new draft remounts the form, which clears its fields. */}
        {pane === 'pick' ? <PickTicketPane /> : <AddItemForm key={draft} />}
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
