// The onboarding dialog: 768px wide over the board, showing one step at a time with a progress bar, Back and Next.
// The empty board, an offer and Resume open it; closing it drops the run until a T3 project is picked, or an offered run until Next or a change, then keeps it to resume.

import { ArrowLeft, ArrowRight, Check, LoaderCircle } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { Progress } from '@lar-factory/ui/progress';
import { StepBody } from './steps.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { type Run, STEPS, finishesOnChecks, onboarded, pickedProject, prClosed, stepReady, useWizardStore } from './wizard-store.ts';

const indexOf = (run: Run) => STEPS.findIndex((s) => s.id === run.step);

/**
 * Back, and Next, which is Finish on the Checks step of a run that reuses its .lar-factory.json. Once the PR is open
 * the run stays on its step, with Close and wait, then Go to the board once it merged, or Close once it closed without
 * merging.
 */
function Nav({ run }: { run: Run }) {
  const { projects, checks, next, back, finish, close } = useWizardStore();
  const data = useBoardStore((s) => s.data);
  const ready = stepReady(run, projects, checks, data.tools);
  if (run.prUrl) {
    return onboarded(run, data) ? <Button size="sm" onClick={close}><Check /> Go to the board</Button>
      : <Button variant="outline" size="sm" onClick={close}>{prClosed(run, data) ? 'Close' : 'Close and wait'}</Button>;
  }
  if (run.step === 'pr') return <Button variant="outline" size="sm" onClick={back}><ArrowLeft /> Back</Button>;
  return (
    <>
      {indexOf(run) > 0 && <Button variant="outline" size="sm" onClick={back}><ArrowLeft /> Back</Button>}
      {finishesOnChecks(run, projects)
        ? <Button data-finish size="sm" disabled={!ready || !!checks?.finishing} onClick={() => void finish()}>
          {checks?.finishing ? <><LoaderCircle className="animate-spin" /> Finishing…</> : <>Finish <Check /></>}</Button>
        : <Button size="sm" disabled={!ready} onClick={next}>Next <ArrowRight /></Button>}
    </>
  );
}

export function WizardDialog() {
  const { run, projects, close } = useWizardStore();
  const data = useBoardStore((s) => s.data);
  const step = run && STEPS[indexOf(run)];
  // A run that reuses its .lar-factory.json finishes on the Checks step, with no PR to open.
  const steps = run && pickedProject(run, projects)?.config ? STEPS.length - 1 : STEPS.length;
  // Once its PR merged, the Pull request step is done too.
  const finished = !!run && onboarded(run, data);
  const doneCount = finished ? steps : run?.done.length ?? 0;
  const done = finished ? 'Onboarded' : `${doneCount} of ${steps} done`;
  return (
    <Dialog open={!!run} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-3xl" data-onboarding-dialog>
        {run && step && (<>
          <DialogHeader>
            <DialogDescription>Onboard {pickedProject(run, projects)?.name ?? run.repo?.split('/')[1] ?? 'a repository'} · step {indexOf(run) + 1} of {steps}</DialogDescription>
            <DialogTitle>{step.label}</DialogTitle>
            <Progress value={doneCount} max={steps} caption={done} aria-label={done} />
          </DialogHeader>
          <DialogPanel className="py-6"><StepBody run={run} step={run.step} /></DialogPanel>
          <DialogFooter><Nav run={run} /></DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}
