// PROTOTYPE (#363), throwaway: the onboarding wizard, a dialog over the board showing one step at a time, with Back and
// Next. Everything that onboards or resumes a repository opens it: the empty board, Resume, the offers for repositories
// with a Repository config, and Settings › Repositories' Add repository.

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { Progress } from '@lar-factory/ui/progress';
import { StepBody } from './steps.tsx';
import { type Run, STEPS, projectOf, stepReady, useWizardStore } from './wizard-store.ts';

const indexOf = (run: Run) => STEPS.findIndex((s) => s.id === run.step);

/** Back and Continue, or Go to the board once the PR has merged. */
function Nav({ run }: { run: Run }) {
  const { next, goTo, close } = useWizardStore();
  const prev = STEPS[indexOf(run) - 1];
  if (run.pr === 'merged') return <Button size="sm" onClick={close}><Check /> Go to the board</Button>;
  const back = prev && <Button variant="outline" size="sm" onClick={() => goTo(prev.id)}><ArrowLeft /> Back</Button>;
  if (run.step === 'pr') return <>{back}<Button variant="outline" size="sm" onClick={close}>Close and wait</Button></>;
  return (
    <>
      {back}
      <Button size="sm" disabled={!stepReady(run, run.step)} onClick={next}>{run.step === 'cleanup' ? 'Review the PR' : 'Continue'} <ArrowRight /></Button>
    </>
  );
}

export function WizardDialog() {
  const run = useWizardStore((s) => s.run);
  const close = useWizardStore((s) => s.close);
  const step = run && STEPS[indexOf(run)]!;
  return (
    <Dialog open={!!run} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-3xl">
        {run && step && (<>
          <DialogHeader>
            <DialogDescription>Onboard {projectOf(run)?.name ?? 'a repository'} · step {indexOf(run) + 1} of {STEPS.length}</DialogDescription>
            <DialogTitle>{step.label}</DialogTitle>
            <Progress value={run.done.length} max={STEPS.length} caption={run.done.length === STEPS.length ? 'Onboarded' : `${run.done.length} of ${STEPS.length} done`} />
          </DialogHeader>
          <DialogPanel className="py-6"><StepBody run={run} step={run.step} /></DialogPanel>
          <DialogFooter>
            <span className="mr-auto self-center text-xs text-muted-foreground">Closing keeps it on the board as onboarding, with Resume.</span>
            <Nav run={run} />
          </DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}
