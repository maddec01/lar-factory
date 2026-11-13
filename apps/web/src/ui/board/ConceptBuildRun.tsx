import type { ConceptBuildPlan } from '@lar-factory/shared';
import { Button, Text } from '@lar-works/design-system';

import { buttonKind } from './ButtonKinds';
import { DetailsSection } from './ItemDetailSections';

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
}: {
    compact?: boolean;
    showAction?: boolean;
    startLabel: string;
    capacity: string;
    plan: ConceptBuildPlan;
    pending: boolean;
    error: string | null;
    onChange: (state: 'running' | 'paused') => void;
}) {
    const running = plan.run?.state === 'running';

    const action = (
        <Button
            {...buttonKind('main')}
            loading={pending}
            disabled={!running && plan.holds.length > 0}
            title={plan.holds.map((hold) => hold.reason).join(' ')}
            onClick={() => onChange(running ? 'paused' : 'running')}
        >
            {running ? 'Pause concept builds' : startLabel}
        </Button>
    );

    if (compact)
        return (
            <div className="flex flex-wrap items-center gap-2" data-concept-build-action>
                {action}
                {!running && plan.holds.length > 0 && (
                    <Text variant="caption" tone="muted" data-concept-build-hold>
                        {plan.holds.map((hold) => hold.reason).join(' ')}
                    </Text>
                )}
                {error && <Text role="alert">{error}</Text>}
            </div>
        );

    return (
        <DetailsSection heading="Concept builds" data-concept-build-run>
            <Text variant="caption" tone="muted" role="status">
                {running
                    ? 'Running · starts unblocked builds as shared capacity becomes available.'
                    : plan.run
                      ? 'Paused · active builds continue.'
                      : 'Not started · shares build capacity with Ready tickets.'}
            </Text>
            <Text variant="caption" tone="muted" data-shared-build-capacity>
                {capacity}
            </Text>
            {plan.run?.reason && <Text variant="caption">{plan.run.reason}</Text>}
            {plan.holds.length > 0 && (
                <ul className="m-0 grid gap-1 pl-4 text-sm" aria-label="Concept build holds">
                    {plan.holds.map((hold, index) => (
                        <li key={`${hold.workId}-${index}`}>{hold.reason}</li>
                    ))}
                </ul>
            )}
            {showAction && <div className="flex flex-wrap gap-2">{action}</div>}
            {error && <Text role="alert">{error}</Text>}
        </DetailsSection>
    );
}
