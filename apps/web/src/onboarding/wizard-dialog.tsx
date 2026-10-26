// The onboarding dialog: 768px wide over the board, showing one step at a time with a progress bar, Back and Next.
// The empty board opens it; closing it drops the run.

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { Progress } from '@lar-factory/ui/progress';
import { StepBody } from './steps.tsx';
import { type Run, STEPS, pickedProject, stepReady, useWizardStore } from './wizard-store.ts';

const indexOf = (run: Run) => STEPS.findIndex((s) => s.id === run.step);

function Nav({ run }: { run: Run }) {
  const { projects, next, back } = useWizardStore();
  return (
    <>
      {indexOf(run) > 0 && <Button variant="outline" size="sm" onClick={back}><ArrowLeft /> Back</Button>}
      <Button size="sm" disabled={!stepReady(run, projects)} onClick={next}>Next <ArrowRight /></Button>
    </>
  );
}

export function WizardDialog() {
  const { run, projects, close } = useWizardStore();
  const step = run && STEPS[indexOf(run)];
  return (
    <Dialog open={!!run} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-3xl" data-onboarding-dialog>
        {run && step && (<>
          <DialogHeader>
            <DialogDescription>Onboard {pickedProject(run, projects)?.name ?? 'a repository'} · step {indexOf(run) + 1} of {STEPS.length}</DialogDescription>
            <DialogTitle>{step.label}</DialogTitle>
            <Progress value={run.done.length} max={STEPS.length} caption={`${run.done.length} of ${STEPS.length} done`} />
          </DialogHeader>
          <DialogPanel className="py-6"><StepBody run={run} step={run.step} /></DialogPanel>
          <DialogFooter><Nav run={run} /></DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}
