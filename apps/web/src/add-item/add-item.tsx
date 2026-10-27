// The title bar's Add item button and its dialog: a form that creates an issue in a configured repo
// and adds it to List. ⌘N opens it too. The store keeps the form's values as they're edited, so a half-written draft
// survives a close. On an Azure repository, Only for <repo> tags the new work item for it.

import { useEffect, useState } from 'react';
import { SquarePen } from 'lucide-react';
import type { FormEvent } from 'react';
import { ITEM_KINDS, noneOnboarded, onAzure, repoName } from '@lar-factory/shared';
import type { RepoConfig } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Field } from '@lar-factory/ui/design-system/Field';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Textarea } from '@lar-factory/ui/design-system/Textarea';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { FormResult } from '../notices/form-result.tsx';
import { itemNoun, useAddItemStore } from './add-item-store.ts';
import type { DraftValues, ResultMessage } from './add-item-store.ts';
import { useBoardStore } from '../board/board-store.ts';
import { AddingARepository } from '../notices/adding-a-repository.tsx';
import { CONTROL } from '../title-bar/control.ts';

/** The repo's custom labels, or tags on Azure DevOps, as toggles, none when it has none; `picked` start ticked. */
function CustomLabels({ repo, picked }: { repo: RepoConfig; picked: readonly string[] }) {
  if (!repo.labels.length) return null;
  return (
    <Fieldset className="custom-labels">
      <FieldsetLegend>{onAzure(repo.repo) ? 'Tags' : 'Labels'}</FieldsetLegend>
      <div className="choices">
        {repo.labels.map((label) => <Checkbox key={label} name="labels" value={label} label={label} defaultChecked={picked.includes(label)} />)}
      </div>
    </Fieldset>
  );
}

/** Only for <repo> on an Azure repository: unticked, the new work item shows in every List that reads its item source. */
function OnlyFor({ repo, name, ticked }: { repo: RepoConfig; name: string; ticked: boolean }) {
  if (repo.items !== 'sprint' && repo.items !== 'backlog') return null;
  return (
    <div className="form-field">
      <Checkbox name="onlyFor" value="true" label={`Only for ${name}`} defaultChecked={ticked} aria-describedby="item-only-for-hint" />
      <p className="form-hint" id="item-only-for-hint">Unticked, it shows in the List of every repository that reads the team's {repo.items}.</p>
    </div>
  );
}

/** The form's values, for the store to keep. */
function valuesOf(form: HTMLFormElement): DraftValues {
  const values = new FormData(form);
  const value = (name: string) => String(values.get(name) ?? '');
  return { repo: value('repo'), kind: value('kind'), title: value('title'), description: value('description'),
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
  const { submission, message, submit, edit, keep, reset } = useAddItemStore();
  // Read once: the fields are uncontrolled and start from the kept draft.
  const [kept] = useState(() => useAddItemStore.getState().values);
  const [repo, setRepo] = useState(kept?.repo ?? data.repos[0]?.repo ?? '');
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
    <Modal.Form id="add-item-form" noValidate aria-busy={phase === 'pending'} onSubmit={onSubmit} onInput={edit}
      onChange={(event) => keep(valuesOf(event.currentTarget))}>
      <Text id="add-item-description" tone="muted" className="shrink-0 px-5 pb-4 sm:px-6">
        Create {itemNoun(selected?.repo) === 'issue' ? 'an issue' : 'a work item'}{selected && ` in ${repoName(selected.repo, data.repos)}`} and add it to List.
      </Text>
      <Modal.Body>
        <Fieldset id="item-fields" unstyled disabled={locked}>
          <div className="form-pair">
            <div className="form-field">
              {/* The Field's box steps aside so its label and select space out as Title's do, with the hint after
                  them: the Field gives its every child the select's id, so the hint can't go in it. */}
              <Field id="item-repo" label="Repository" className="contents">
                {/* Uncontrolled and read on input: the form's onInput re-renders before the select's change
                    event, and a controlled select would be set back to the old repo. */}
                <NativeSelect name="repo" required defaultValue={repo} onInput={(event) => setRepo(event.currentTarget.value)}
                  aria-describedby={hint ? 'item-repo-hint' : undefined}>
                  {data.repos.map((r) => <option value={r.repo} key={r.repo}>{repoName(r.repo, data.repos)}</option>)}
                </NativeSelect>
              </Field>
              {hint && <p className="form-hint" id="item-repo-hint">No repository is onboarded. <AddingARepository /></p>}
            </div>
            <Field id="item-kind" label="Kind" className="form-field">
              <NativeSelect name="kind" required defaultValue={kept?.kind ?? ''}>
                <option value="">Choose a kind</option>
                {ITEM_KINDS.map((kind) => <option value={kind} key={kind}>{kind}</option>)}
              </NativeSelect>
            </Field>
          </div>
          {/* Keyed by repo, so another repo's labels start unchecked. */}
          {selected && <CustomLabels repo={selected} picked={selected.repo === kept?.repo ? kept.labels : []} key={selected.repo} />}
          {selected && <OnlyFor repo={selected} name={repoName(selected.repo, data.repos)} ticked={selected.repo === kept?.repo && kept.onlyFor}
            key={`only-${selected.repo}`} />}
          <Field id="item-title" label="Title (required)" className="form-field">
            <Input name="title" required maxLength={256} autoComplete="off" defaultValue={kept?.title} />
          </Field>
          <Field id="item-description" label="Description (optional)" className="form-field">
            <Textarea name="description" rows={4} maxLength={65536} defaultValue={kept?.description} />
          </Field>
        </Fieldset>
        <Result message={message} />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" id="item-new" hidden={phase !== 'uncertain'} onClick={reset}>New item</Button>
        <Button type="submit" id="item-submit"
          disabled={phase === 'pending' || phase === 'uncertain' || data.capture?.enabled === false || !data.repos.length}>
          {phase === 'pending' ? 'Adding…' : phase === 'retry' ? 'Retry this submission' : 'Add to List'}
        </Button>
      </Modal.Footer>
    </Modal.Form>
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
  return (<>
    <Button variant="primary" className={`add-item ${CONTROL} px-2`} leftIcon={<SquarePen />} title="Add item (⌘N)" aria-keyshortcuts="Meta+N"
      onClick={() => setOpen(true)}><span className="@max-[70rem]:sr-only [.title-bar:has(.update-button)_&]:@max-[74rem]:sr-only">Add item</span></Button>
    {open && (
      <Modal onClose={() => setOpen(false)}>
        {/* ninna-ui's Modal drops the description from aria-describedby, so the description names itself. */}
        <Modal.Content id="add-item-dialog" title="Add item" aria-describedby="add-item-description">
          {/* A new draft remounts the form, which clears its fields. */}
          <AddItemForm key={draft} />
        </Modal.Content>
      </Modal>
    )}
  </>);
}
