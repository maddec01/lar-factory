import { conceptBuildHoldSummary, type ConceptBuildPlan } from '@lar-factory/shared';
import { Button, Disclosure, Text } from '@lar-works/design-system';
import { type ReactNode, useId } from 'react';

import { buttonKind } from './ButtonKinds';
import { DetailsSection } from './ItemDetailSections';
import { ActionError } from './StartControls';
import { useButtonKind } from './useButtonKind';
import { workHoldReason } from './work-hold-reason';

/** A concept's authorization and complete preflight, separate from its shaping action. */
export function ConceptBuildRun({
    plan,
    pending,
    error,
    onChange,
    compact = false,
    showAction = true,
    startLabel,
    holdLabel,
    ready,
    capacity,
    progress,
    holdsSummarized = false,
}: {
    progress?: { total: number; complete: number; building: number; waiting: number; names: string; outside: number };
    holdsSummarized?: boolean;
    compact?: boolean;
    showAction?: boolean;
    startLabel: string;
    /** Why the run is held, in words naming its parts; the shared summary by default. */
    holdLabel?: string;
    /** A part that can start while the run is held: its name ("#139") and its Build. */
    ready?: { name: string; action: ReactNode } | undefined;
    capacity: string | null;
    plan: ConceptBuildPlan;
    pending: boolean;
    error: string | null;
    onChange: (state: 'running' | 'paused') => void;
}) {
    const running = plan.run?.state === 'running';
    const holdWords = holdLabel ?? conceptBuildHoldSummary(plan);
    // "Waiting on …" says itself; named parts read "Build all held until Part 26 and Part 27 are decided", naming the run the row's
    // Build all starts, so a part that can start by itself never reads as held too.
    const holdSentence = !holdWords || holdWords.startsWith('Waiting') ? holdWords : `Build all held ${holdWords}`;
    const finished =
        plan.run?.state === 'completed' || Boolean(progress?.total && progress.complete === progress.total);

    const held = !running && plan.holds.length > 0;
    const heldId = useId();
    // The row's Build all is a row action: tinted with the others on the row (TintedActions).
    const kindOf = useButtonKind();
    // Held, it is an ordinary disabled button, not a washed-out Main, with why beside it.
    const action = (
        <Button
            {...buttonKind(held ? 'other' : 'main')}
            loading={pending}
            disabled={held}
            aria-describedby={held ? heldId : undefined}
            title={plan.holds.map((hold) => workHoldReason(hold.reason)).join(' ')}
            onClick={() => onChange(running ? 'paused' : 'running')}
        >
            {running ? 'Pause concept builds' : startLabel}
        </Button>
    );

    // A row offers the run only when it can act: a held run says why in the expanded concept and its dialog, not as a
    // disabled button in the row's action slot.
    if (compact && (finished || !showAction || (!running && plan.holds.length > 0))) return null;

    if (compact)
        return (
            <div className="flex items-center gap-2" data-concept-build-action>
                <Button
                    {...kindOf('main')}
                    loading={pending}
                    title={running ? 'Pause concept builds' : startLabel}
                    onClick={() => onChange(running ? 'paused' : 'running')}
                >
                    {running ? 'Pause' : 'Build all'}
                </Button>
                {error && <ActionError>{error}</ActionError>}
            </div>
        );

    // An expanded concept on the board says its builds in one quiet line, its holds folded under it; its dialog keeps
    // the full section.
    if (holdsSummarized) {
        const done = progress && progress.total > 0 ? `${progress.complete}/${progress.total} builds done` : null;
        const summary = [
            done,
            running ? 'running' : holdSentence ? holdSentence[0]!.toLowerCase() + holdSentence.slice(1) : '',
        ]
            .filter(Boolean)
            .join(' · ');

        if (!summary) return null;

        return (
            <div data-concept-build-run>
                {plan.holds.length > 0 && !running ? (
                    <Disclosure label={summary} presentation="section">
                        <ul
                            className="m-0 grid list-disc gap-1 pl-4 text-left text-sm wrap-anywhere"
                            aria-label="Concept build holds"
                        >
                            {plan.holds.map((hold, index) => (
                                <li key={`${hold.workId}-${index}`}>{workHoldReason(hold.reason)}</li>
                            ))}
                        </ul>
                    </Disclosure>
                ) : (
                    <Text variant="caption" tone="muted" role="status" data-concept-build-progress>
                        {summary}
                    </Text>
                )}
                {error && <ActionError>{error}</ActionError>}
            </div>
        );
    }

    return (
        <DetailsSection heading="Concept builds" data-concept-build-run>
            <Text variant="caption" tone="muted" role="status" data-concept-build-progress>
                {progress && progress.total > 0
                    ? [
                          // The dialog's parts header already counts the builds done; this line says what moves.
                          progress.building ? `${progress.building} building` : 'None building',
                          // While held, a part that can start by itself counts as ready, not waiting.
                          held && ready && '1 ready',
                          progress.waiting - (held && ready ? 1 : 0) > 0 &&
                              `${progress.waiting - (held && ready ? 1 : 0)} waiting`,
                      ]
                          .filter(Boolean)
                          .join(' · ')
                    : plan.run?.state === 'completed'
                      ? 'All planned builds complete.'
                      : running
                        ? 'Starts unblocked builds as shared capacity becomes available.'
                        : plan.run
                          ? 'Paused · active builds continue.'
                          : 'No builds started.'}
            </Text>
            {capacity && (
                <Text variant="caption" tone="muted" data-shared-build-capacity>
                    {capacity}
                </Text>
            )}
            {Boolean(progress?.outside) && (
                <Text variant="caption">
                    {progress!.outside} {progress!.outside === 1 ? 'build is' : 'builds are'} outside the board. Add{' '}
                    {progress!.outside === 1 ? 'its Project' : 'their Projects'} in Settings to let this work start.
                </Text>
            )}
            {plan.run?.reason && <Text variant="caption">{plan.run.reason}</Text>}
            {plan.holds.length > 0 && (
                <Disclosure label={holdSentence} presentation="section">
                    <ul
                        className="m-0 grid list-disc gap-1 pl-4 text-left text-sm wrap-anywhere"
                        aria-label="Concept build holds"
                    >
                        {plan.holds.map((hold, index) => (
                            <li key={`${hold.workId}-${index}`}>{workHoldReason(hold.reason)}</li>
                        ))}
                    </ul>
                </Disclosure>
            )}
            {showAction && !finished && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* Held with a part that can start now, the section offers that part's Build, not a dead button. */}
                    {held && ready ? <span className="inline-flex shrink-0">{ready.action}</span> : action}
                    {held && (
                        <Text id={heldId} variant="caption" tone="muted" data-concept-build-held>
                            {ready
                                ? `${ready.name} can start now; the rest wait`
                                : 'Can start once what it waits on is done'}
                        </Text>
                    )}
                </div>
            )}
            {error && <ActionError>{error}</ActionError>}
        </DetailsSection>
    );
}
