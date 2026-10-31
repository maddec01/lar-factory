// The onboarding dialog: the copied Modal over the board, showing one step at a time with a progress bar, Back and Next,
// and Finish on the last step. The empty board, an offer and Resume open it; closing it drops the run until a T3 project
// is picked, or an offered run until Next or a change, then keeps it to resume. Once Finish saves, it says so, with Go to the board.

import { useEffect, useRef } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { Progress } from '@lar-factory/ui/progress';
import { StepBody } from './steps.tsx';
import { STEP_TITLES, type StepId } from './wizard-choices.ts';
import { type Run, pickedProject, runSteps, stepReady, useWizardStore } from './wizard-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { useSettingsStore } from '../settings/settings-store.ts';

const STEP_HELP: Record<StepId, string> = {
  project: 'Choose where agents will work.',
  work: 'Choose what to show and what builds may save.',
  access: 'Check the access the factory needs.',
};

/**
 * Where focus goes when the dialog closes and the copied Modal found nowhere to return it: the button that opened it;
 * once that's gone, as the Resume of a repository the dialog finished, the page's main heading.
 */
function closedFocus(opener: HTMLElement | null): HTMLElement | null {
  if (opener?.isConnected) return opener;
  return document.querySelector<HTMLElement>('.title-bar h1');
}

/** Back, then Next, or on the last step Finish; once Finish saved, Go to the board. */
function Nav({ run }: { run: Run }) {
  const { projects, detection, finish, next, back, save, close } = useWizardStore();
  if (finish.state === 'done') return <Button {...kind('main')} leftIcon={<Check />} onClick={() => { close(); useSettingsStore.getState().setOpen(false); }}>Go to the board</Button>;
  const steps = runSteps(run, detection);
  const at = steps.indexOf(run.step);
  const ready = stepReady(run, projects, detection);
  return (
    <>
      {at > 0 && <Button {...kind('other')} disabled={finish.state === 'saving'} onClick={back}>Back</Button>}
      {at === steps.length - 1
        ? <Button {...kind('main')} disabled={!ready} loading={finish.state === 'saving'} leftIcon={<Check />} onClick={() => void save()}>Add repository</Button>
        : <Button {...kind('main')} disabled={!ready} rightIcon={<ArrowRight />} onClick={() => void next()}>Next</Button>}
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
  const { projects, detection, finish, close } = useWizardStore();
  const dialog = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const finished = finish.state === 'done';
  const place = finished ? 'done' : run.step;
  useEffect(() => {
    const moved = place !== shown.current;
    shown.current = place;
    // Opening, a new step, or a button such as Retry that went away with this render, puts focus on the step's heading, not the page.
    if (moved) {
      const body = dialog.current?.querySelector<HTMLElement>('[data-slot="modal-body"]');
      if (body) body.scrollTop = 0;
    }
    if (moved || document.activeElement === document.body) stepHeading(dialog.current)?.focus();
  });
  const steps = runSteps(run, detection);
  const at = steps.indexOf(run.step);
  const doneCount = finished ? steps.length : at;
  const done = finished ? 'Ready' : `Step ${at + 1} of ${steps.length}`;
  return (
    <Modal onClose={close}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the step's place names itself. */}
      <Modal.Content ref={dialog} data-onboarding-dialog title={finished ? 'Repository added' : STEP_TITLES[run.step]} aria-describedby="onboarding-place"
        description={finished ? undefined : STEP_HELP[run.step]} focusFirstField={false}>
        <div className="grid shrink-0 gap-2 px-5 pb-4 sm:px-6">
          <Text id="onboarding-place" tone="muted">
            Set up {pickedProject(run, projects)?.name ?? (run.repo && shownRepo(run.repo).split('/').at(-1)) ?? 'a repository'}.
          </Text>
          <Progress value={doneCount} max={steps.length} caption={done} aria-label={done} />
        </div>
        <Modal.Body><StepBody run={run} /></Modal.Body>
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
