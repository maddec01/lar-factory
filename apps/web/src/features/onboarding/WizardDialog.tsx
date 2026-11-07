// The onboarding dialog: the design system's Modal over the board, showing one step at a time with a progress bar, Back and Next,
// and Finish on the last step. The empty board, an offer and Resume open it; closing it drops the run until a T3 project
// is picked, or an offered run until Next or a change, then keeps it to resume. Once Finish saves, it says so, with Go to the board.

import { shownRepo } from '@lar-factory/shared';
import { Button, buttonKind, Modal, Progress, Text } from '@lar-works/design-system';
import { ArrowRight, Check } from '@lar-works/design-system/icons';
import { useEffect, useRef } from 'react';

import { StepBody } from './Steps';
import { STEP_TITLES } from './WizardChoices';
import { type Run, pickedProject, runSteps, stepReady, useWizardStore } from './WizardStore';
import { ProjectChoiceIcon, ProjectIcon } from '@/features/repositories';
import { useSettingsStore } from '@/features/settings';

/**
 * Where focus goes when the dialog closes and the design system's Modal found nowhere to return it: the button that opened it;
 * once that's gone, as the Resume of a repository the dialog finished, the page's main heading.
 */
function closedFocus(opener: HTMLElement | null): HTMLElement | null {
    if (opener?.isConnected) return opener;

    return document.querySelector<HTMLElement>('.title-bar h1');
}

/** Back, then Next, or on the last step Finish; once Finish saved, Go to the board. */
function Nav({ run }: { run: Run }) {
    const { projects, detection, finish, next, back, save, close } = useWizardStore();

    if (finish.state === 'done')
        return (
            <Button
                {...buttonKind('main')}
                leftIcon={<Check />}
                onClick={() => {
                    close();
                    useSettingsStore.getState().setOpen(false);
                }}
            >
                Go to the board
            </Button>
        );

    const steps = runSteps(run, detection);
    const at = steps.indexOf(run.step);
    const savingLabels = Object.values(run.choices.newLabels ?? {}).some((names) => names?.some((name) => name.trim()));
    const ready = stepReady(run, projects, detection);

    return (
        <>
            {at > 0 && (
                <Button {...buttonKind('other')} disabled={finish.state === 'saving'} onClick={back}>
                    Back
                </Button>
            )}
            {at === steps.length - 1 ? (
                <Button
                    {...buttonKind('main')}
                    disabled={!ready}
                    loading={finish.state === 'saving'}
                    leftIcon={<Check />}
                    onClick={() => void save()}
                >
                    {savingLabels ? 'Save and add Project' : 'Add Project'}
                </Button>
            ) : (
                <Button
                    {...buttonKind('main')}
                    disabled={!ready}
                    rightIcon={<ArrowRight />}
                    onClick={() => void next()}
                >
                    Next
                </Button>
            )}
        </>
    );
}

/** The step's heading in the design system's Modal's header, which takes focus without being a Tab stop. */
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
    const picked = pickedProject(run, projects);

    return (
        <Modal onClose={close}>
            {/* The progress and Project line describe their own content. */}
            <Modal.Content
                ref={dialog}
                data-onboarding-dialog
                title={finished ? 'Project added' : STEP_TITLES[run.step]}
                aria-describedby={undefined}
                focusFirstField={false}
            >
                <div className="grid shrink-0 gap-2 px-5 pb-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-2">
                        {picked ? (
                            <ProjectChoiceIcon project={picked} size="row" />
                        ) : (
                            run.repo && <ProjectIcon repo={run.repo} size="row" />
                        )}
                        <Text id="onboarding-place" tone="muted">
                            Set up {picked?.name ?? (run.repo && shownRepo(run.repo).split('/').at(-1)) ?? 'a Project'}.
                        </Text>
                    </div>
                    <Progress value={doneCount} max={steps.length} caption={done} aria-label={done} />
                </div>
                <Modal.Body>
                    <StepBody run={run} />
                </Modal.Body>
                <Modal.Footer>
                    <Nav run={run} />
                </Modal.Footer>
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

        // The design system's Modal returns focus on the next task when the element that had it is still on the page.
        const timer = setTimeout(() => {
            if (document.activeElement === document.body) closedFocus(opener)?.focus();
        });

        return () => clearTimeout(timer);
    }, [open, opener]);

    return run && <WizardModal run={run} />;
}
