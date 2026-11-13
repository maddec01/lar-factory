import { conceptBuildHoldSummary, type ConceptBuildPlan } from '@lar-factory/shared';
import { Button, Disclosure, Text } from '@lar-works/design-system';

import { buttonKind } from './ButtonKinds';
import { DetailsSection } from './ItemDetailSections';
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
    capacity,
    progress,
}: {
    progress?: { total: number; complete: number; building: number; waiting: number; names: string; outside: number };
    compact?: boolean;
    showAction?: boolean;
    startLabel: string;
    capacity: string | null;
    plan: ConceptBuildPlan;
    pending: boolean;
    error: string | null;
    onChange: (state: 'running' | 'paused') => void;
}) {
    const running = plan.run?.state === 'running';
    const finished = Boolean(progress?.total && progress.complete === progress.total);

    const action = (
        <Button
            {...buttonKind('main')}
            loading={pending}
            disabled={!running && plan.holds.length > 0}
            title={plan.holds.map((hold) => workHoldReason(hold.reason)).join(' ')}
            onClick={() => onChange(running ? 'paused' : 'running')}
        >
            {running ? 'Pause concept builds' : startLabel}
        </Button>
    );

    if (compact && (finished || !showAction)) return null;

    if (compact)
        return (
            <div className="flex flex-wrap items-center gap-2" data-concept-build-action>
                {action}
                {!running && plan.holds.length > 0 && (
                    <Disclosure label={conceptBuildHoldSummary(plan)}>
                        <ul
                            className="m-0 grid list-disc gap-1 pl-4 text-left text-sm"
                            aria-label="Concept build holds"
                        >
                            {plan.holds.map((hold, index) => (
                                <li key={`${hold.workId}-${index}`}>{workHoldReason(hold.reason)}</li>
                            ))}
                        </ul>
                    </Disclosure>
                )}
                {error && <Text role="alert">{error}</Text>}
            </div>
        );

    return (
        <DetailsSection heading="Concept builds" data-concept-build-run>
            <Text variant="caption" tone="muted" role="status" data-concept-build-progress>
                {progress && progress.total > 0
                    ? `${progress.building} building · ${progress.waiting} waiting · ${progress.complete}/${progress.total} complete`
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
                <ul className="m-0 grid list-disc gap-1 pl-4 text-left text-sm" aria-label="Concept build holds">
                    {plan.holds.map((hold, index) => (
                        <li key={`${hold.workId}-${index}`}>{workHoldReason(hold.reason)}</li>
                    ))}
                </ul>
            )}
            {showAction && !finished && <div className="flex flex-wrap gap-2">{action}</div>}
            {error && <Text role="alert">{error}</Text>}
        </DetailsSection>
    );
}
