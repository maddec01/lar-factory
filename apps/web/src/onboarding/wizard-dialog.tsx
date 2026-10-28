// The onboarding dialog: the copied Modal over the board, showing one step at a time with a progress bar, Back and Next.
// The empty board, an offer and Resume open it; closing it drops the run until a T3 project is picked, or an offered run until Next or a change, then keeps it to resume.

import { useEffect, useRef } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { Progress } from '@lar-factory/ui/progress';
import { useBoardStore } from '../board/board-store.ts';
import { StepBody } from './steps.tsx';
import { type Run, type StepId, STEPS, onboarded, pickedProject, prClosed, stepReady, stepTitle, useWizardStore } from './wizard-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

const STEP_HELP: Record<StepId, string> = {
  project: 'Connect a repository folder so agents know where to work.',
  setup: 'Choose what to show and tell agents what this repository does.',
  labels: 'Set up labels to group work and track its progress.',
  checks: 'Check tools and access so agents can read work and push changes.',
  cleanup: 'Check agent instructions to prevent rules from working against each other.',
  pr: 'Review and merge a pull request to save the setup in your repository.',
};

const indexOf = (run: Run) => STEPS.findIndex((s) => s.id === run.step);

/**
 * Where focus goes when the dialog closes and the copied Modal found nowhere to return it: the button that opened it;
 * once that's gone, as the Resume of a repository the dialog finished, the page's main heading.
 */
function closedFocus(opener: HTMLElement | null): HTMLElement | null {
  if (opener?.isConnected) return opener;
  return document.querySelector<HTMLElement>('.title-bar h1');
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
    return onboarded(run, data) ? <Button {...kind('main')} leftIcon={<Check />} onClick={close}>Go to the board</Button>
      : <Button {...kind('other')} onClick={close}>{prClosed(run, data) ? 'Close' : 'Close and wait'}</Button>;
  }
  if (run.step === 'pr') return <Button {...kind('other')} onClick={back}>Back</Button>;
  return (
    <>
      {indexOf(run) > 0 && <Button {...kind('other')} onClick={back}>Back</Button>}
      <Button {...kind('main')} disabled={!ready} rightIcon={<ArrowRight />} onClick={next}>Next</Button>
    </>
  );
}

/** The step's heading in the copied Modal's header, which takes focus without being a Tab stop. */
function stepHeading(dialog: HTMLElement | null): HTMLElement | null {
  const heading = dialog?.querySelector<HTMLElement>('[data-slot="modal-header"] h2') ?? null;
  if (heading) {
    heading.tabIndex = -1;
    heading.classList.add('outline-none');
  }
  return heading;
}

/** The dialog while a run is open: the step's title, its place and the progress bar, the step, then Back and Next. */
function WizardModal({ run }: { run: Run }) {
  const { projects, close } = useWizardStore();
  const dialog = useRef<HTMLDivElement>(null);
  const shown = useRef<StepId | null>(null);
  useEffect(() => {
    const moved = run.step !== shown.current;
    shown.current = run.step;
    // Opening, a new step, or a button such as Retry that went away with this render, puts focus on the step's heading, not the page.
    if (moved) {
      const body = dialog.current?.querySelector<HTMLElement>('[data-slot="modal-body"]');
      if (body) body.scrollTop = 0;
    }
    if (moved || document.activeElement === document.body) stepHeading(dialog.current)?.focus();
  });
  const data = useBoardStore((s) => s.data);
  const step = STEPS[indexOf(run)]!;
  const steps = STEPS.length;
  // Once its PR merged, the Pull request step is done too.
  const finished = onboarded(run, data);
  const doneCount = finished ? steps : run.done.length;
  const done = finished ? 'Ready' : `${doneCount} of ${steps} done`;
  return (
    <Modal onClose={close}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the step's place names itself. */}
      <Modal.Content ref={dialog} data-onboarding-dialog title={stepTitle(step.id, run.provider)} aria-describedby="onboarding-place" description={run.step === 'labels' && run.provider === 'Azure DevOps' ? 'Set up tags to group work and track its progress.' : STEP_HELP[run.step]} focusFirstField={false}>
        <div className="grid shrink-0 gap-2 px-5 pb-4 sm:px-6">
          <Text id="onboarding-place" tone="muted">
            Set up {pickedProject(run, projects)?.name ?? (run.repo && shownRepo(run.repo).split('/').at(-1)) ?? 'a repository'}. Step {indexOf(run) + 1} of {steps}.
          </Text>
          <Progress value={doneCount} max={steps} caption={done} aria-label={done} />
        </div>
        <Modal.Body><StepBody run={run} step={run.step} /></Modal.Body>
        <Modal.Footer><Nav run={run} /></Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}

export function WizardDialog() {
  const run = useWizardStore((state) => state.run);
  const opener = useWizardStore((state) => state.opener);
  const open = run !== null;
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    // The copied Modal returns focus on the next task when the element that had it is still on the page.
    const timer = setTimeout(() => { if (document.activeElement === document.body) closedFocus(opener)?.focus(); });
    return () => clearTimeout(timer);
  }, [open, opener]);
  return run && <WizardModal run={run} />;
}
