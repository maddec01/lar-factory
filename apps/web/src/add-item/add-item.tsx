// Add item captures a draft locally or creates its tracker ticket, and can find existing tickets.
import { useEffect, useRef, useState } from 'react';
import { SquarePen } from 'lucide-react';
import type { FormEvent } from 'react';
import { ITEM_KINDS, noneOnboarded, repoName } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Fieldset } from '@lar-factory/ui/fieldset';
import { FormSelect } from '@lar-factory/ui/form-select';
import { FormResult } from '../notices/form-result.tsx';
import { useAddItemStore } from './add-item-store.ts';
import type { AddItemPane, DraftValues } from './add-item-store.ts';
import { CreateIssueBox, IssueFields, PanelSection, ticketOptions } from './issue-fields.tsx';
import { TicketPicker } from './ticket-picker.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { AddingARepository } from '../notices/adding-a-repository.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { DescriptionEditor } from '../description-editor/description-editor.tsx';
import { EXPANDED, ExpandButton, useExpand } from '../expand-dialog/expand-dialog.tsx';
import { KIND_BADGES } from '../items/item-parts.tsx';

const HINT = 'm-0 text-xs leading-snug text-(--muted-foreground)';
const KIND_CHOICES = ITEM_KINDS.map((value) => {
  const { name, icon: Icon, hue } = KIND_BADGES[value]!;
  return { value, name, icon: <Icon style={{ color: `oklch(0.62 0.15 ${hue})` }} /> };
});

/** The form's values, the editor's `description` and the Create issue `createChoice`, for the store to keep. */
function valuesOf(form: HTMLFormElement, description: string, createChoice: boolean | null): DraftValues {
  const values = new FormData(form);
  const value = (name: string) => String(values.get(name) ?? '');
  const createIssue = values.has('createIssue');
  const options = createIssue ? ticketOptions(form) : undefined;
  return { repo: value('repo'), kind: value('kind'), title: value('title'), description, createIssue, ...(options ? { options } : {}), ...(createChoice === null ? {} : { createChoice }) };
}

/** The repository select both panes start with, and the hint when none is onboarded. */
function RepoSelect({ id, repo, onRepo }: { id: string; repo: string; onRepo: (repo: string) => void }) {
  const data = useBoardStore((state) => state.data);
  const hint = noneOnboarded(data);
  return (<>
    <FormSelect id={id} name="repo" value={repo} onChange={onRepo} aria-describedby={hint ? `${id}-hint` : undefined}
      choices={data.repos.map((r) => ({ value: r.repo, name: repoName(r.repo, data.repos) }))} />
    {hint && <p className={HINT} id={`${id}-hint`}>No repository is onboarded. <AddingARepository /></p>}
  </>);
}

function AddItemForm() {
  const data = useBoardStore((state) => state.data);
  const { submission, message, submit, edit, keep, reset, setOpen } = useAddItemStore();
  // Read once: the fields start from the kept draft.
  const [kept] = useState(() => useAddItemStore.getState().values);
  const [repo, setRepo] = useState(kept?.repo ?? data.repos[0]?.repo ?? '');
  const [itemKind, setKind] = useState(kept?.kind ?? '');
  const [createChoice, setCreateChoice] = useState(kept?.createChoice ?? null);
  const selected = data.repos.find(r => r.repo === repo) ?? data.repos[0];
  const form = useRef<HTMLFormElement>(null);
  const kindSelect = useRef<HTMLButtonElement>(null);
  // The editor is no form field, so its Markdown is kept here.
  const description = useRef(kept?.description ?? '');
  const { phase } = submission;
  const locked = phase !== 'editing';
  const keepForm = () => keep(valuesOf(form.current!, description.current, createChoice));
  // The checkbox's input event comes before this render, so the choice is kept once it has rendered.
  useEffect(() => { if (createChoice !== null) keepForm(); }, [createChoice]);
  // An edit in the editor counts as one in the form.
  const onDescription = (markdown: string) => {
    description.current = markdown;
    edit();
    keepForm();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void submit(valuesOf(form, description.current, createChoice)).then(() => {
      if (useAddItemStore.getState().submission.phase === 'editing' && form.isConnected && form.reportValidity() && !itemKind) kindSelect.current?.focus();
    });
  };
  return (
    <Modal.Form ref={form} id="add-item-form" noValidate aria-busy={phase === 'pending'} onSubmit={onSubmit} onInput={() => { edit(); keepForm(); }}>
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
            <p className={`${HINT} shrink-0`}>Formats as you type · saved as Markdown</p>
            <FormResult id="item-result" text={message} />
          </div>
          <aside aria-label="Details" className="grid content-start gap-5 overflow-y-auto border-l border-base-300 bg-base-50/60 px-4 py-4 @max-[40rem]:overflow-visible @max-[40rem]:border-l-0 @max-[40rem]:border-t">
            <PanelSection heading="Repository" htmlFor="item-repo">
              <RepoSelect id="item-repo" repo={selected?.repo ?? ''} onRepo={setRepo} />
            </PanelSection>
            <PanelSection heading="Kind" htmlFor="item-kind">
              <FormSelect ref={kindSelect} id="item-kind" name="kind" placeholder="Choose a kind" value={itemKind} onChange={setKind} choices={KIND_CHOICES} />
            </PanelSection>
            {selected && <IssueFields key={selected.repo} repo={selected} kind={itemKind} kept={kept?.repo === selected.repo ? kept : null} choice={createChoice} />}
          </aside>
        </Fieldset>
      </div>
      <Modal.Footer leading={selected && <CreateIssueBox repo={selected} choice={createChoice} onChoice={setCreateChoice} disabled={locked} />}>
        <Button {...kind('other')} id="item-new" hidden={phase !== 'uncertain'} onClick={reset}>New item</Button>
        <Button {...kind('other')} onClick={() => setOpen(false)}>Cancel</Button>
        <Button {...kind('main')} type="submit" id="item-submit"
          disabled={phase === 'pending' || phase === 'uncertain' || data.capture?.enabled === false || !data.repos.length}>
          {phase === 'pending' ? 'Adding…' : phase === 'retry' ? 'Retry this submission' : 'Add item'}
        </Button>
      </Modal.Footer>
    </Modal.Form>
  );
}

/** Find a ticket: the repository, then the ticket picker for it. Picking closes the dialog. */
function PickTicketPane() {
  const data = useBoardStore((state) => state.data);
  const { pick, setOpen } = useAddItemStore();
  const [repo, setRepo] = useState(() => useAddItemStore.getState().values?.repo ?? data.repos[0]?.repo ?? '');
  // Opened before the repositories arrived, repo matches none: the first is then selected.
  const selected = data.repos.find((r) => r.repo === repo) ?? data.repos[0];
  const disabled = data.capture?.enabled === false || !selected;
  return (<>
    <div className="grid min-h-0 content-start gap-4 overflow-y-auto border-t border-base-300 px-5 pb-5 pt-4 sm:px-6" id="pick-ticket">
      <p className={HINT}>Find tickets outside your list, or open one you’ve already added.</p>
      <PanelSection heading="Repository" htmlFor="pick-repo">
        <RepoSelect id="pick-repo" repo={selected?.repo ?? ''} onRepo={setRepo} />
      </PanelSection>
      <TicketPicker id="pick" repo={selected?.repo ?? ''} disabled={disabled} key={selected?.repo} onPick={(ticket) => pick(selected!.repo, ticket)} />
      {data.capture?.enabled === false && <p className={HINT}>Picking tickets is disabled in sample mode.</p>}
    </div>
    <Modal.Footer>
      <Button {...kind('other')} onClick={() => setOpen(false)}>Cancel</Button>
    </Modal.Footer>
  </>);
}

/** New work or Find a ticket, as two buttons, the shown pane's pressed. */
function PaneSwitch() {
  const { pane, setPane } = useAddItemStore();
  const choice = (to: AddItemPane, label: string) => (
    <button type="button" data-pane={to} aria-pressed={pane === to} onClick={() => setPane(to)}
      className={`h-7 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${pane === to ? 'bg-base-100 text-base-content shadow-sm' : 'text-(--muted-foreground) hover:text-base-content'}`}>{label}</button>
  );
  return (
    <div role="group" aria-label="Add" className="flex gap-0.5 rounded-lg bg-base-200 p-0.5">
      {choice('new', 'New work')}{choice('pick', 'Find a ticket')}
    </div>
  );
}

/** What the shown pane does, in the repository the form has picked: the kept draft's, else the first. */
function useDescription(): string {
  const repos = useBoardStore((state) => state.data.repos);
  const { pane, values } = useAddItemStore();
  const selected = repos.find((r) => r.repo === values?.repo) ?? repos[0];
  const where = selected ? ` in ${repoName(selected.repo, repos)}` : '';
  return pane === 'pick' ? `Find an open ticket${where}.` : `Record work${where} and add it to List.`;
}

/** Find a ticket's pane is short, so the dialog keeps its width but takes the pane's height; a long result list scrolls inside it. */
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
