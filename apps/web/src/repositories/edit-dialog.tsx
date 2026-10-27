// Edit's dialog over Settings › Repositories: onboarding's setup fields and custom label picker, filled in from the
// repository's .lar-factory.json on its open Edit PR's branch or else its default branch, then Cancel and Save, which
// opens a PR on that file or adds a commit to the open one. On Azure DevOps the fields offer the team's sprint and
// backlog, and the custom labels are tags, which Save leaves for the board to write on first use. While Save runs the fields, Cancel and Esc wait for it.

import { CircleAlert, LoaderCircle } from 'lucide-react';
import { onAzure, shownRepo } from '@lar-factory/shared';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
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
      {form.error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t save</AlertTitle><AlertDescription>{form.error}</AlertDescription></Alert>}
    </fieldset>
  );
}

export function EditDialog() {
  const { edit, close, retry, save } = useEditStore();
  const form = edit?.form;
  return (
    <Dialog open={!!edit} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-2xl" data-edit-dialog>
        {edit && (<>
          <DialogHeader>
            <DialogTitle>Edit {shownRepo(edit.repo)}</DialogTitle>
            <DialogDescription className="text-xs">{onAzure(edit.repo) ? 'Save opens' : `Save creates the custom labels ${shownRepo(edit.repo)} lacks and opens`} a PR on its .lar-factory.json, its Repository config. The board keeps the default branch’s values until the PR merges.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="py-6">
            {form?.state === 'loading' && <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading .lar-factory.json…</p>}
            {form?.state === 'failed' && (
              <Alert variant="error"><CircleAlert /><AlertTitle>Can’t read {shownRepo(edit.repo)}’s Repository config</AlertTitle><AlertDescription>{form.error}</AlertDescription>
                <AlertAction><Button variant="outline" size="xs" onClick={() => void retry()}>Retry</Button></AlertAction></Alert>
            )}
            {form?.state === 'loaded' && <Form repo={edit.repo} form={form} />}
          </DialogPanel>
          <DialogFooter>
            {form?.state === 'loaded' && unchanged(form) && <span data-no-changes className="self-center text-xs text-muted-foreground sm:me-auto">No changes yet</span>}
            <DialogClose disabled={form?.state === 'loaded' && form.saving} render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
            <Button data-save size="sm" disabled={form?.state !== 'loaded' || !canSave(form)} onClick={() => void save()}>
              {form?.state === 'loaded' && form.saving ? <><LoaderCircle className="animate-spin" /> Saving…</> : 'Save'}</Button>
          </DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}
