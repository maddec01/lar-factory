// PROTOTYPE (#363), throwaway: three variants of the onboarding wizard, differing only in where it lives.
// A, Takeover: it replaces the main area like Settings does, with a step rail on the left.
// B, Dialog: a dialog over the board showing one step at a time, with Back and Next.
// C, Checklist: one scrolling page in Settings › Repositories; each section unlocks once the one above finishes.

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { Progress } from '@lar-factory/ui/progress';
import { useTitlebarInset } from '../sidebar/window-controls.tsx';
import { RepositoriesGroup } from './board.tsx';
import { StatusIcon, StepBody, stepState, stepSummary } from './steps.tsx';
import { type Run, STEPS, projectOf, stepReady, useWizardStore } from './wizard-store.ts';

const title = (run: Run) => projectOf(run)?.name ?? 'a repository';
const indexOf = (run: Run) => STEPS.findIndex((s) => s.id === run.step);

/** Back and Continue, or Go to the board once the PR has merged. */
function Nav({ run, compact }: { run: Run; compact?: boolean }) {
  const { next, goTo, close } = useWizardStore();
  const i = indexOf(run);
  const prev = STEPS[i - 1];
  if (run.pr === 'merged') return <Button size={compact ? 'sm' : 'default'} onClick={close}><Check /> Go to the board</Button>;
  if (run.step === 'pr') return <>{prev && <Button variant="outline" size={compact ? 'sm' : 'default'} onClick={() => goTo(prev.id)}><ArrowLeft /> Back</Button>}<Button variant="outline" size={compact ? 'sm' : 'default'} onClick={close}>Close and wait</Button></>;
  return (
    <>
      {prev && <Button variant="outline" size={compact ? 'sm' : 'default'} onClick={() => goTo(prev.id)}><ArrowLeft /> Back</Button>}
      <Button size={compact ? 'sm' : 'default'} disabled={!stepReady(run, run.step)} onClick={next}>{run.step === 'cleanup' ? 'Review the PR' : 'Continue'} <ArrowRight /></Button>
    </>
  );
}

export function Takeover() {
  const run = useWizardStore((s) => s.run);
  const { goTo, close } = useWizardStore();
  const inset = useTitlebarInset();
  if (!run) return null;
  const step = STEPS[indexOf(run)]!;
  return (
    <>
      <header className={`flex h-13 shrink-0 select-none items-center gap-2 border-b border-(--border) pr-4 ${inset} [-webkit-app-region:drag]`}>
        <span className="text-[13px] text-(--muted-foreground)">Onboarding</span><span className="text-(--muted-foreground)" aria-hidden="true">›</span>
        <h1 className="m-0 text-[13px] font-medium">{title(run)}</h1>
        <Button size="xs" variant="ghost" className="ml-auto [-webkit-app-region:no-drag]" onClick={close} title="Closing keeps the repository on the board as onboarding, with Resume"><X /> Close</Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Onboarding steps" className="w-64 shrink-0 overflow-y-auto border-r p-3">
          <ol className="m-0 grid list-none gap-1 p-0">
            {STEPS.map((s, n) => {
              const state = stepState(run, s.id);
              const reachable = run.done.includes(s.id) || run.step === s.id;
              return (
                <li key={s.id}>
                  <button type="button" disabled={!reachable} onClick={() => goTo(s.id)} aria-current={run.step === s.id ? 'step' : undefined}
                    className={`flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left disabled:cursor-default ${run.step === s.id ? 'bg-accent' : reachable ? 'hover:bg-accent/60' : 'opacity-60'}`}>
                    <StatusIcon status={state} />
                    <span className="grid min-w-0 gap-0.5"><span className="text-[13px] font-medium">{n + 1}. {s.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{state === 'locked' ? 'Locked' : stepSummary(run, s.id)}</span></span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid max-w-2xl gap-5 px-8 py-8">
              <div><p className="m-0 text-xs text-muted-foreground">Step {indexOf(run) + 1} of {STEPS.length}</p><h2 className="m-0 text-lg font-semibold">{step.label}</h2></div>
              <StepBody run={run} step={run.step} />
            </div>
          </div>
          <footer className="flex justify-end gap-2 border-t bg-muted/40 px-8 py-3"><Nav run={run} /></footer>
        </div>
      </div>
    </>
  );
}

export function WizardDialog() {
  const run = useWizardStore((s) => (s.variant === 'B' ? s.run : null));
  const close = useWizardStore((s) => s.close);
  const step = run && STEPS[indexOf(run)]!;
  return (
    <Dialog open={!!run} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-2xl">
        {run && step && (<>
          <DialogHeader>
            <DialogDescription>Onboard {title(run)} · step {indexOf(run) + 1} of {STEPS.length}</DialogDescription>
            <DialogTitle>{step.label}</DialogTitle>
            <Progress value={run.done.length} max={STEPS.length} caption={run.done.length === STEPS.length ? 'Onboarded' : `${run.done.length} of ${STEPS.length} done`} />
          </DialogHeader>
          <DialogPanel><StepBody run={run} step={run.step} /></DialogPanel>
          <DialogFooter>
            <span className="mr-auto self-center text-xs text-muted-foreground">Closing keeps it on the board as onboarding, with Resume.</span>
            <Nav run={run} compact />
          </DialogFooter>
        </>)}
      </DialogPopup>
    </Dialog>
  );
}

function Checklist({ run }: { run: Run }) {
  const close = useWizardStore((s) => s.close);
  const current = useRef<HTMLElement>(null);
  // Braces: scrollIntoView now returns a promise, which React would take for a cleanup.
  useEffect(() => { void current.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [run.step]);
  const at = indexOf(run);
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2 px-1">
        <div className="min-w-0 flex-1"><h3 className="m-0 text-[13px] font-medium">Onboard {title(run)}</h3>
          <p className="m-0 text-xs text-muted-foreground">Each section unlocks once the one above finishes.</p></div>
        <Button size="xs" variant="ghost" onClick={close} title="Closing keeps the repository on the board as onboarding, with Resume"><X /> Close</Button>
      </div>
      <ol className="m-0 grid list-none gap-3 p-0">
        {STEPS.map((s, n) => {
          const locked = n > at && !run.done.includes(s.id);
          return (
            <li key={s.id}>
              <section ref={n === at ? current : undefined} className={`scroll-mt-4 overflow-hidden rounded-xl border bg-card ${n === at ? 'ring-2 ring-ring/30' : ''} ${locked ? 'opacity-60' : ''}`}>
                <header className="flex items-center gap-3 border-b px-4 py-3">
                  <StatusIcon status={stepState(run, s.id)} />
                  <span className="text-[13px] font-medium">{n + 1}. {s.label}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{locked ? `Unlocks once ${STEPS[n - 1]!.label} finishes` : stepSummary(run, s.id)}</span>
                </header>
                {!locked && <div className="grid gap-4 px-4 py-4"><StepBody run={run} step={s.id} />
                  {n === at && <div className="flex justify-end gap-2"><Nav run={run} compact /></div>}</div>}
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Settings › Repositories' list, and in variant C the checklist under it. */
export function RepositoriesPrototype() {
  const run = useWizardStore((s) => (s.variant === 'C' ? s.run : null));
  return <><RepositoriesGroup />{run && <Checklist run={run} />}</>;
}
