// Edit's dialog over Settings › Repositories: onboarding's setup fields and custom label picker, filled in from the
// repository's .lar-factory.json on its open Edit PR's branch or else its default branch, then Cancel and Save, which
// opens a PR on that file or adds a commit to the open one. On Azure DevOps the fields offer the team's sprint and
// backlog, and the custom labels are tags, which Save leaves for the board to write on first use. While Save runs the fields, Cancel and Esc wait for it.

import { LoaderCircle, RotateCw } from 'lucide-react';
import { onAzure, shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { CustomLabelPicker, SetupFields } from '../onboarding/setup-fields.tsx';
import { prName } from '../onboarding/steps.tsx';
import { type EditForm, canSave, unchanged, useEditStore } from './edit-store.ts';

function Form({ repo, form }: { repo: string; form: EditForm }) {
  const { answer, toggle, type, add } = useEditStore();
  return (
    <fieldset disabled={form.saving} className="m-0 grid min-w-0 gap-5 border-0 p-0">
      {form.editPr && <p data-edit-pr className="m-0 text-sm">These values come from <a className="font-medium underline" href={form.editPr} target="_blank" rel="noopener">
        {prName(form.editPr)}</a>, its open Edit PR. Save adds a commit to that PR.</p>}
      <SetupFields repo={repo} azure={onAzure(repo)} setup={form.setup} action="Save" disabled={form.saving} onAnswer={answer} />
      <CustomLabelPicker repo={repo} azure={onAzure(repo)} offered={form.offered} picked={form.picked} typed={form.typed} adding={false} busy={form.saving} error={null} disabled={form.saving}
        onToggle={toggle} onType={type} onAdd={add} />
      {form.error && <Alert tone="danger" title="Can’t save">{form.error}</Alert>}
    </fieldset>
  );
}

export function EditDialog() {
  const { edit, close, retry, save } = useEditStore();
  if (!edit) return null;
  const form = edit.form;
  const saving = form.state === 'loaded' && form.saving;
  return (
    <Modal loading={saving} onClose={close}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the description names itself. */}
      <Modal.Content data-edit-dialog title={`Edit ${shownRepo(edit.repo)}`} aria-describedby="edit-description">
        <Text id="edit-description" tone="muted" className="shrink-0 px-5 pb-4 text-xs sm:px-6">
          {onAzure(edit.repo) ? 'Save opens' : `Save creates the custom labels ${shownRepo(edit.repo)} lacks and opens`} a PR on its .lar-factory.json, its Repository config. The board keeps the default branch’s values until the PR merges.
        </Text>
        <Modal.Body>
          {form.state === 'loading' && <p className="m-0 flex items-center gap-2 text-sm text-base-700"><LoaderCircle className="size-4 animate-spin" /> Reading .lar-factory.json…</p>}
          {form.state === 'failed' && (
            <Alert tone="danger" title={`Can’t read ${shownRepo(edit.repo)}’s Repository config`}
              action={<Button variant="secondary" leftIcon={<RotateCw />} onClick={() => void retry()}>Retry</Button>}>{form.error}</Alert>
          )}
          {form.state === 'loaded' && <Form repo={edit.repo} form={form} />}
        </Modal.Body>
        <Modal.Footer leading={form.state === 'loaded' && unchanged(form) && <span data-no-changes className="text-xs text-base-700">No changes yet</span>}>
          <Button variant="secondary" disabled={saving} onClick={close}>Cancel</Button>
          <Button data-save disabled={form.state !== 'loaded' || !canSave(form)} loading={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}
