// The onboarding dialog: 768px wide over the board, showing one step at a time with a progress bar, Back and Next.
// The empty board, an offer and Resume open it; closing it drops the run until a T3 project is picked, or an offered run until Next or a change, then keeps it to resume.

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { Progress } from '@lar-factory/ui/progress';
import { StepBody } from './steps.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { shownRepo } from '@lar-factory/shared';
import { type Run, type StepId, STEPS, onboarded, pickedProject, prClosed, stepReady, stepTitle, useWizardStore } from './wizard-store.ts';

const indexOf = (run: Run) => STEPS.findIndex((s) => s.id === run.step);

/**
 * Where focus goes when the dialog closes: the button that opened it; once that's gone, as the Resume of a repository
 * the dialog finished, the page's main heading.
 */
function closedFocus(opener: HTMLElement | null): HTMLElement | true {
  if (opener?.isConnected) return opener;
  return document.querySelector<HTMLElement>('.title-bar h1') ?? true;
}

/**
 * Back and Next. Once the PR is open the run stays on its step, with Close and wait, then Go to the board once it merged, or Close once it closed without
 * merging.
 */
function Nav({ run }: { run: Run }) {
  const { projects, checks, clashes, agent, labels, next, back, close } = useWizardStore();
  const data = useBoardStore((s) => s.data);
  const ready = stepReady(run, projects, checks, data.tools, clashes, agent, labels);
  if (run.prUrl) {
    return onboarded(run, data) ? <Button size="sm" onClick={close}><Check /> Go to the board</Button>
      : <Button variant="outline" size="sm" onClick={close}>{prClosed(run, data) ? 'Close' : 'Close and wait'}</Button>;
  }
  if (run.step === 'pr') return <Button variant="outline" size="sm" onClick={back}><ArrowLeft /> Back</Button>;
  return (
    <>
      {indexOf(run) > 0 && <Button variant="outline" size="sm" onClick={back}><ArrowLeft /> Back</Button>}
      <Button size="sm" disabled={!ready} onClick={next}>Next <ArrowRight /></Button>
    </>
  );
}

export function WizardDialog() {
  const { run, projects, opener, close } = useWizardStore();
  const title = useRef<HTMLHeadingElement>(null);
  const shown = useRef<StepId | null>(null);
  useEffect(() => {
    const now = run?.step ?? null;
    const moved = shown.current !== null && now !== null && now !== shown.current;
    shown.current = now;
    // A new step, or a button such as Retry that went away with this render, puts focus on the step's heading, not the page.
    if (moved || now && document.activeElement === document.body) title.current?.focus();
  });
  const data = useBoardStore((s) => s.data);
  const step = run && STEPS[indexOf(run)];
  const steps = STEPS.length;
  // Once its PR merged, the Pull request step is done too.
  const finished = !!run && onboarded(run, data);
  const doneCount = finished ? steps : run?.done.length ?? 0;
  const done = finished ? 'Onboarded' : `${doneCount} of ${steps} done`;
  return (
    <Dialog open={!!run} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-3xl" data-onboarding-dialog finalFocus={() => closedFocus(opener)}>
        {run && step && (<>
          <DialogHeader>
            <DialogDescription>Onboard {pickedProject(run, projects)?.name ?? (run.repo && shownRepo(run.repo).split('/').at(-1)) ?? 'a repository'} · step {indexOf(run) + 1} of {steps}</DialogDescription>
            <DialogTitle ref={title} tabIndex={-1} className="outline-none">{stepTitle(step.id, run.provider)}</DialogTitle>
            <Progress value={doneCount} max={steps} caption={done} aria-label={done} />
          </DialogHeader>
          <DialogPanel className="py-6"><StepBody run={run} step={run.step} /></DialogPanel>
          <DialogFooter><Nav run={run} /></DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}
