// The title bar's Add item button and its dialog: a form that creates an issue in a configured repo
// and adds it to List. ⌘N opens it too. The dialog stays mounted while closed, so a half-written draft survives. On an
// Azure repository, Only for <repo> tags the new work item for it.

import { useEffect, useState } from 'react';
import { SquarePen } from 'lucide-react';
import type { FormEvent } from 'react';
import { ITEM_KINDS, noneOnboarded, onAzure, repoName } from '@lar-factory/shared';
import type { RepoConfig } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';
import { Checkbox } from '@lar-factory/ui/checkbox';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle, DialogTrigger } from '@lar-factory/ui/dialog';
import { Button as LarButton } from '@lar-factory/ui/design-system/Button';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { Input } from '@lar-factory/ui/input';
import { KeptMountedDialogPopup } from '@lar-factory/ui/kept-mounted-dialog-popup';
import { Label } from '@lar-factory/ui/label';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { Textarea } from '@lar-factory/ui/textarea';
import { FormResult } from '../notices/form-result.tsx';
import { itemNoun, useAddItemStore } from './add-item-store.ts';
import type { ResultMessage } from './add-item-store.ts';
import { useBoardStore } from '../board/board-store.ts';
import { AddingARepository } from '../notices/adding-a-repository.tsx';

/** The repo's custom labels, or tags on Azure DevOps, as toggles, none when it has none. Base UI's checkboxes don't follow a native
 * fieldset's disabled, so they take it themselves. */
function CustomLabels({ repo, disabled }: { repo: RepoConfig; disabled: boolean }) {
  if (!repo.labels.length) return null;
  return (
    <Fieldset className="custom-labels">
      <FieldsetLegend>{onAzure(repo.repo) ? 'Tags' : 'Labels'}</FieldsetLegend>
      <div className="choices">
        {repo.labels.map((label) => <Label key={label}><Checkbox name="labels" value={label} disabled={disabled} />{label}</Label>)}
      </div>
    </Fieldset>
  );
}

/** Only for <repo> on an Azure repository: unticked, the new work item shows in every List that reads its item source. */
function OnlyFor({ repo, name, disabled }: { repo: RepoConfig; name: string; disabled: boolean }) {
  if (repo.items !== 'sprint' && repo.items !== 'backlog') return null;
  return (
    <div className="form-field">
      <Label><Checkbox name="onlyFor" value="true" disabled={disabled} aria-describedby="item-only-for-hint" />Only for {name}</Label>
      <p className="form-hint" id="item-only-for-hint">Unticked, it shows in the List of every repository that reads the team's {repo.items}.</p>
    </div>
  );
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
  // Opened before the repositories arrived, repo matches none: the select then shows the first.
  const selected = data.repos.find((r) => r.repo === repo) ?? data.repos[0];
  const hint = noneOnboarded(data);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void submit({ repo: values.get('repo'), kind: values.get('kind'), title: values.get('title'),
      description: values.get('description'), labels: values.getAll('labels'), onlyFor: values.get('onlyFor') === 'true' }).then(() => {
      if (useAddItemStore.getState().submission.phase === 'editing' && form.isConnected) form.reportValidity();
    });
  };
  return (
    <form id="add-item-form" className="flex min-h-0 flex-col" noValidate aria-busy={phase === 'pending'} onSubmit={onSubmit} onInput={edit}>
      <DialogHeader>
        <DialogTitle id="add-item-heading">Add item</DialogTitle>
        <DialogDescription>Create {itemNoun(selected?.repo) === 'issue' ? 'an issue' : 'a work item'}{selected && ` in ${repoName(selected.repo, data.repos)}`} and add it to List.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <Fieldset id="item-fields" unstyled disabled={locked}>
          <div className="form-pair">
            <div className="form-field">
              <Label htmlFor="item-repo">Repository</Label>
              {/* Uncontrolled and read on input: the form's onInput re-renders before the select's change
                  event, and a controlled select would be set back to the old repo. */}
              <NativeSelect id="item-repo" name="repo" required defaultValue={repo} onInput={(event) => setRepo(event.currentTarget.value)}
                aria-describedby={hint ? 'item-repo-hint' : undefined}>
                {data.repos.map((r) => <option value={r.repo} key={r.repo}>{repoName(r.repo, data.repos)}</option>)}
              </NativeSelect>
              {hint && <p className="form-hint" id="item-repo-hint">No repository is onboarded. <AddingARepository /></p>}
            </div>
            <div className="form-field">
              <Label htmlFor="item-kind">Kind</Label>
              <NativeSelect id="item-kind" name="kind" required defaultValue="">
                <option value="">Choose a kind</option>
                {ITEM_KINDS.map((kind) => <option value={kind} key={kind}>{kind}</option>)}
              </NativeSelect>
            </div>
          </div>
          {/* Keyed by repo, so another repo's labels start unchecked. */}
          {selected && <CustomLabels repo={selected} disabled={locked} key={selected.repo} />}
          {selected && <OnlyFor repo={selected} name={repoName(selected.repo, data.repos)} disabled={locked} key={`only-${selected.repo}`} />}
          <div className="form-field">
            <Label htmlFor="item-title">Title <span className="required-note">(required)</span></Label>
            <Input id="item-title" name="title" required maxLength={256} autoComplete="off" nativeInput />
          </div>
          <div className="form-field">
            <Label htmlFor="item-description">Description <span className="required-note">(optional)</span></Label>
            <Textarea id="item-description" name="description" rows={4} maxLength={65536} />
          </div>
        </Fieldset>
        <Result message={message} />
      </DialogPanel>
      <DialogFooter>
        <Button type="submit" id="item-submit"
          disabled={phase === 'pending' || phase === 'uncertain' || data.capture?.enabled === false || !data.repos.length}>
          {phase === 'pending' ? 'Adding…' : phase === 'retry' ? 'Retry this submission' : 'Add to List'}
        </Button>
        <Button variant="outline" size="xs" id="item-new" hidden={phase !== 'uncertain'} onClick={reset}>New item</Button>
      </DialogFooter>
    </form>
  );
}

export function AddItem() {
  const { draft, open, setOpen } = useAddItemStore();
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
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* The dialog's trigger, so closing it returns focus here. */}
      <DialogTrigger render={<LarButton variant="primary" className="add-item" leftIcon={<SquarePen />} title="Add item (⌘N)" aria-keyshortcuts="Meta+N" />}><span className="@max-[70rem]:sr-only [.title-bar:has(.update-button)_&]:@max-[74rem]:sr-only">Add item</span></DialogTrigger>
      <KeptMountedDialogPopup id="add-item-dialog" initialFocus={() => document.getElementById('item-repo')}>
        {/* A new draft remounts the form, which clears its fields. */}
        <AddItemForm key={draft} />
      </KeptMountedDialogPopup>
    </Dialog>
  );
}
