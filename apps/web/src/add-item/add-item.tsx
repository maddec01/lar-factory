// The header's Add item button and its dialog: a form that creates an issue in a configured repo
// and adds it to List. The dialog stays mounted while closed, so a half-written draft survives.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { applicability, ITEM_KINDS } from '@mux-factory/shared';
import type { RepoConfig } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle, DialogTrigger } from '@mux-factory/ui/dialog';
import { KeptMountedDialogPopup } from '@mux-factory/ui/kept-mounted-dialog-popup';
import { FormResult } from '../notices/form-result.tsx';
import { useAddItemStore } from './add-item-store.ts';
import type { ResultMessage } from './add-item-store.ts';
import { useBoardStore } from '../board/board-store.ts';

/** The applicability checkboxes of one repo, each group with the hint for choosing none. */
function Applicability({ repo }: { repo: RepoConfig }) {
  return applicability(repo.platform).map((group, g) => (
    <fieldset className="applicability" aria-describedby={`item-hint-${g}`} key={group.title}>
      <legend>{group.title}</legend>
      <div className="choices">
        {group.labels.map((label) => <label key={label}><input type="checkbox" name="labels" value={label} /> {label}</label>)}
      </div>
      <p className="form-hint" id={`item-hint-${g}`}>{group.hint}</p>
    </fieldset>
  ));
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
  const { submission, message, submit, edit, reset } = useAddItemStore();
  const [repo, setRepo] = useState(data.repos[0]?.repo ?? '');
  const { phase } = submission;
  const locked = phase !== 'editing';
  const selected = data.repos.find((r) => r.repo === repo);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void submit({ repo: values.get('repo'), kind: values.get('kind'), title: values.get('title'),
      description: values.get('description'), labels: values.getAll('labels') }).then(() => {
      if (useAddItemStore.getState().submission.phase === 'editing' && form.isConnected) form.reportValidity();
    });
  };
  return (
    <form id="add-item-form" className="flex min-h-0 flex-col" noValidate aria-busy={phase === 'pending'} onSubmit={onSubmit} onInput={edit}>
      <DialogHeader>
        <DialogTitle id="add-item-heading">Add item</DialogTitle>
        <DialogDescription>Create an issue in {data.project.title} and add it to List.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <fieldset id="item-fields" className="item-fields" disabled={locked}>
          <div className="form-pair">
            <div className="form-field">
              <label htmlFor="item-repo">Repository</label>
              {/* Uncontrolled and read on input: the form's onInput re-renders before the select's change
                  event, and a controlled select would be set back to the old repo. */}
              <select id="item-repo" name="repo" required defaultValue={repo} onInput={(event) => setRepo(event.currentTarget.value)}>
                {data.repos.map((r) => <option value={r.repo} key={r.repo}>{r.platform}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="item-kind">Kind</label>
              <select id="item-kind" name="kind" required defaultValue="">
                <option value="">Choose a kind</option>
                {ITEM_KINDS.map((kind) => <option value={kind} key={kind}>{kind}</option>)}
              </select>
            </div>
          </div>
          {/* Keyed by repo, so another repo's groups start unchecked. */}
          {selected && <Applicability repo={selected} key={selected.repo} />}
          <div className="form-field">
            <label htmlFor="item-title">Title <span className="required-note">(required)</span></label>
            <input id="item-title" name="title" required maxLength={256} autoComplete="off" />
          </div>
          <div className="form-field">
            <label htmlFor="item-description">Description <span className="required-note">(optional)</span></label>
            <textarea id="item-description" name="description" rows={4} maxLength={65536} />
          </div>
        </fieldset>
        <Result message={message} />
      </DialogPanel>
      <DialogFooter>
        <Button type="submit" id="item-submit"
          disabled={phase === 'pending' || phase === 'uncertain' || data.capture?.enabled === false}>
          {phase === 'pending' ? 'Adding…' : phase === 'retry' ? 'Retry this submission' : 'Add to List'}
        </Button>
        <Button variant="outline" size="xs" id="item-new" hidden={phase !== 'uncertain'} onClick={reset}>New item</Button>
      </DialogFooter>
    </form>
  );
}

export function AddItem() {
  const { draft, open, setOpen } = useAddItemStore();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="add-item" render={<Button variant="outline" size="xs" />}>Add item</DialogTrigger>
      <KeptMountedDialogPopup id="add-item-dialog" initialFocus={() => document.getElementById('item-repo')}>
        {/* A new draft remounts the form, which clears its fields. */}
        <AddItemForm key={draft} />
      </KeptMountedDialogPopup>
    </Dialog>
  );
}
