// The onboarding dialog: 768px wide over the board, showing one step at a time with a progress bar, Back and Next.
// The empty board and Resume open it; closing it drops the run until a T3 project is picked, then keeps it to resume.

import { ArrowLeft, ArrowRight, Check, LoaderCircle } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { Progress } from '@lar-factory/ui/progress';
import { StepBody } from './steps.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { type Run, STEPS, finishesOnChecks, pickedProject, stepReady, useWizardStore } from './wizard-store.ts';

const indexOf = (run: Run) => STEPS.findIndex((s) => s.id === run.step);

/** Back, and Next, which is Finish on the Checks step of a run that reuses its .lar-factory.json. */
function Nav({ run }: { run: Run }) {
  const { projects, checks, next, back, finish } = useWizardStore();
  const tools = useBoardStore((s) => s.data.tools);
  const ready = stepReady(run, projects, checks, tools);
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
  const step = run && STEPS[indexOf(run)];
  // A run that reuses its .lar-factory.json finishes on the Checks step, with no PR to open.
  const steps = run && pickedProject(run, projects)?.config ? STEPS.length - 1 : STEPS.length;
  const done = `${run?.done.length} of ${steps} done`;
  return (
    <Dialog open={!!run} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-3xl" data-onboarding-dialog>
        {run && step && (<>
          <DialogHeader>
            <DialogDescription>Onboard {pickedProject(run, projects)?.name ?? run.repo?.split('/')[1] ?? 'a repository'} · step {indexOf(run) + 1} of {steps}</DialogDescription>
            <DialogTitle>{step.label}</DialogTitle>
            <Progress value={run.done.length} max={steps} caption={done} aria-label={done} />
          </DialogHeader>
          <DialogPanel className="py-6"><StepBody run={run} step={run.step} /></DialogPanel>
          <DialogFooter><Nav run={run} /></DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}
