// Edit's dialog over Settings › Repositories: onboarding's setup fields and custom label picker, filled in from the
// repository's .lar-factory.json on its default branch, then Cancel and Save, which opens a PR on that file.

import { CircleAlert, LoaderCircle } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { CustomLabelPicker, SetupFields } from '../onboarding/setup-fields.tsx';
import { type EditForm, canSave, useEditStore } from './edit-store.ts';

function Form({ repo, form }: { repo: string; form: EditForm }) {
  const { answer, toggle, type, add } = useEditStore();
  return (
    <div className="grid gap-5">
      <SetupFields repo={repo} setup={form.setup} action="Save" onAnswer={answer} />
      <CustomLabelPicker repo={repo} offered={form.offered} picked={form.picked} typed={form.typed} adding={false} busy={form.saving} error={null}
        onToggle={toggle} onType={type} onAdd={add} />
      {form.error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t save</AlertTitle><AlertDescription>{form.error}</AlertDescription></Alert>}
    </div>
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
            <DialogTitle>Edit {edit.repo}</DialogTitle>
            <DialogDescription className="text-xs">Save creates the custom labels {edit.repo} lacks and opens a PR on its .lar-factory.json, its Repository config. The board keeps the default branch’s values until the PR merges.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="py-6">
            {form?.state === 'loading' && <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading .lar-factory.json…</p>}
            {form?.state === 'failed' && (
              <Alert variant="error"><CircleAlert /><AlertTitle>Can’t read {edit.repo}’s Repository config</AlertTitle><AlertDescription>{form.error}</AlertDescription>
                <AlertAction><Button variant="outline" size="xs" onClick={() => void retry()}>Retry</Button></AlertAction></Alert>
            )}
            {form?.state === 'loaded' && <Form repo={edit.repo} form={form} />}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
            <Button data-save size="sm" disabled={form?.state !== 'loaded' || !canSave(form)} onClick={() => void save()}>
              {form?.state === 'loaded' && form.saving ? <><LoaderCircle className="animate-spin" /> Saving…</> : 'Save'}</Button>
          </DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}
