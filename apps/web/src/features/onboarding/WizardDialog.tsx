// The onboarding dialog: the design system's Modal over the board, showing one step at a time with a progress bar, Back and Next,
// and Finish on the last step. The empty board, an offer and Resume open it; closing it drops the run until a T3 project
// is picked, or an offered run until Next or a change, then keeps it to resume. Once Finish saves, it says so, with Go to the board.
// Opened from Settings › Projects, the same steps take the section's place as a child pane with Back, rather than
// stacking a second dialog over Settings; leaving the pane closes the run as closing the dialog does.

import { shownRepo } from '@lar-factory/shared';
import {
    Button,
    Modal,
    Progress,
    SettingsChildPane,
    SettingsFooter,
    Text,
    useModalClose,
    useSettingsDraft,
} from '@lar-works/design-system';
import { ArrowRight, Check } from '@lar-works/design-system/icons';
import { useEffect, useRef } from 'react';

import { StepBody } from './Steps';
import { STEP_TITLES } from './WizardChoices';
import { type Run, pickedProject, runSteps, stepReady, useWizardStore } from './WizardStore';
import { ProjectChoiceIcon, ProjectIcon } from '@/features/repositories';
import { useSettingsStore } from '@/features/settings';
import { buttonKind, SetupHeader, SetupPane } from '@/ui/board';

/**
 * Where focus goes when the dialog or the pane closes and the design system's Modal found nowhere to return it: the button
 * that opened it; once that's gone, as the Resume of a repository the dialog finished, Settings while the pane leaves them
 * open, or else the page's main heading.
 */
function closedFocus(opener: HTMLElement | null): HTMLElement | null {
    if (opener?.isConnected) return opener;

    return document.querySelector<HTMLElement>('[role="dialog"]') ?? document.querySelector<HTMLElement>('main h1');
}

/** Back, then Next, or on the last step Finish; once Finish saved, Go to the board; on a sample board, back to it. */
function Nav({ run }: { run: Run }) {
    const { projects, detection, finish, next, back, save, close } = useWizardStore();

    const toBoard = () => {
        close();
        useSettingsStore.getState().setOpen(false);
    };

    if (finish.state === 'done')
        return (
            <Button {...buttonKind('main', { size: 'md' })} leftIcon={<Check />} onClick={toBoard}>
                Go to the board
            </Button>
        );

    // A sample board adds no Project, so the way on is back to it, not a Next that can never enable.
    if (projects.state === 'sample')
        return (
            <Button {...buttonKind('main', { size: 'md' })} onClick={toBoard}>
                Explore the sample board
            </Button>
        );

    const steps = runSteps(run, detection);
    const at = steps.indexOf(run.step);
    const savingLabels = Object.values(run.choices.newLabels ?? {}).some((names) => names?.some((name) => name.trim()));
    const ready = stepReady(run, projects, detection);

    return (
        <>
            {at > 0 && (
                <Button {...buttonKind('other', { size: 'md' })} disabled={finish.state === 'saving'} onClick={back}>
                    Back
                </Button>
            )}
            {at === steps.length - 1 ? (
                <Button
                    {...buttonKind('main', { size: 'md' })}
                    disabled={!ready}
                    loading={finish.state === 'saving'}
                    leftIcon={<Check />}
                    onClick={() => void save()}
                >
                    {savingLabels ? 'Save and add project' : 'Add project'}
                </Button>
            ) : (
                <Button
                    {...buttonKind('main', { size: 'md' })}
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

/**
 * Opening, a new step, or a button such as Retry that went away with this render, puts focus on the step's `heading`,
 * not the page; a new step starts at the top of the scrolling `body`.
 */
function useStepFocus(place: string, heading: () => HTMLElement | null, body: () => HTMLElement | null) {
    const shown = useRef<string | null>(null);

    useEffect(() => {
        const moved = place !== shown.current;

        shown.current = place;

        if (moved) {
            const scroller = body();

            if (scroller) scroller.scrollTop = 0;
        }

        if (moved || document.activeElement === document.body) heading()?.focus();
    });
}

/** What the dialog and the pane both show over the step: its title, and the Project's icon and place over the progress. */
function useSetupView(run: Run, presentation: 'dialog' | 'pane') {
    const { projects, detection, finish } = useWizardStore();
    const finished = finish.state === 'done';
    const steps = runSteps(run, detection);
    const at = steps.indexOf(run.step);
    const doneCount = finished ? steps.length : at + 1;
    const done = finished ? 'Ready' : `Step ${at + 1} of ${steps.length}`;
    const picked = pickedProject(run, projects);

    return {
        place: finished ? 'done' : run.step,
        // Settings' breadcrumb names the pane Add a project, so its heading names the step from the first.
        title: finished
            ? 'Project added'
            : run.step === 'project' && presentation === 'dialog'
              ? 'Add a project'
              : STEP_TITLES[run.step],
        header: (
            <SetupHeader
                presentation={presentation}
                icon={
                    picked ? (
                        <ProjectChoiceIcon project={picked} size="md" />
                    ) : (
                        run.repo && <ProjectIcon repo={run.repo} size="md" />
                    )
                }
                place={
                    <Text id="onboarding-place" tone="muted">
                        {picked?.name || run.repo
                            ? `Set up ${picked?.name ?? shownRepo(run.repo!).split('/').at(-1)}.`
                            : 'Choose a repository to work on.'}
                    </Text>
                }
                progress={<Progress value={doneCount} max={steps.length} caption={done} aria-label={done} />}
            />
        ),
    };
}

/** The dialog while a run is open: the step's title, its place and the progress bar, the step, then Back and Next. */
function WizardModal({ run }: { run: Run }) {
    const close = useWizardStore((state) => state.close);
    const dialog = useRef<HTMLDivElement>(null);
    const { place, title, header } = useSetupView(run, 'dialog');

    useStepFocus(
        place,
        () => stepHeading(dialog.current),
        () => dialog.current?.querySelector<HTMLElement>('[data-slot="modal-body"]') ?? null,
    );

    return (
        <Modal onClose={close}>
            {/* The progress and Project line describe their own content. */}
            <Modal.Content
                ref={dialog}
                data-onboarding-dialog
                title={title}
                aria-describedby={undefined}
                focusFirstField={false}
            >
                {header}
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

/**
 * Add project from Settings › Projects: the run as a child pane in the section's place, inside Settings' own frame,
 * with Projects (Back) over the step's title, its place and the progress bar, the step, then Back and Next in Settings'
 * footer. Back, changing section and closing Settings close the run as closing the dialog does; a folder typed for a
 * new T3 project, which closing drops, is a draft they ask about first.
 */
export function WizardPane({ run }: { run: Run }) {
    const { creating, finish, close } = useWizardStore();
    const requestClose = useModalClose();
    const { place, title, header } = useSetupView(run, 'pane');
    const pane = () => document.querySelector<HTMLElement>('[data-onboarding-pane]');

    useSettingsDraft(!!creating?.folder.trim() && !creating.adding);
    useStepFocus(
        place,
        () => pane()?.querySelector<HTMLElement>('[data-setup-title]') ?? null,
        () => pane()?.closest<HTMLElement>('[data-slot="modal-body"]') ?? null,
    );

    return (
        <>
            <SettingsChildPane
                title="Add a project"
                backDisabled={finish.state === 'saving'}
                onBack={() => requestClose(close)}
            >
                <SetupPane data-onboarding-pane title={title} header={header}>
                    <StepBody run={run} />
                </SetupPane>
            </SettingsChildPane>
            <SettingsFooter>
                <Nav run={run} />
            </SettingsFooter>
        </>
    );
}

export function WizardDialog() {
    const run = useWizardStore((state) => state.run);
    const opener = useWizardStore((state) => state.opener);
    const where = useWizardStore((state) => state.where);
    const open = run !== null;
    const wasOpen = useRef(false);

    useEffect(() => {
        const closed = wasOpen.current && !open;

        wasOpen.current = open;

        if (!closed) return;

        // The design system's Modal returns focus on the next task when the element that had it is still on the page.
        // Leaving the pane, Settings' dialog takes the focus of the Back that went, so its own box counts as nowhere too.
        const timer = setTimeout(() => {
            const at = document.activeElement;

            if (at === document.body || at?.matches('[role="dialog"]')) closedFocus(opener)?.focus();
        });

        return () => clearTimeout(timer);
    }, [open, opener]);

    // Opened from Settings › Projects, the run shows there, as WizardPane.
    return run && where === 'dialog' && <WizardModal run={run} />;
}
