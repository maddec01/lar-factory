import { plural, releaseHolds, type ReleaseEvidence, type ReleasePlan } from '@lar-factory/shared';
import { CopyButton, Disclosure, Text } from '@lar-works/design-system';
import { CheckIcon, CircleIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { DetailFact, MainSection, SectionHeader } from './ItemDetails';
import { MetaLine, Moment } from './TextParts';
import { workHoldReason } from './work-hold-reason';

function RecordedAt({ evidence }: { evidence: ReleaseEvidence }) {
    return <Moment at={evidence.at} />;
}

/** The checklist says Done or the Outcome result; exact revisions and commands stay in its details. */
function Evidence({ evidence }: { evidence: ReleaseEvidence }) {
    return (
        <Disclosure label="Evidence details" presentation="section">
            <Text variant="caption" tone="muted" breaks>
                {evidence.evidence}
            </Text>
            <CopyButton label="Copy full release evidence" copiedLabel="Evidence copied" value={evidence.evidence} />
        </Disclosure>
    );
}

/** Parent-owned release checklist, shared by the group and its item details. */
export function ReleaseProgress({
    plan,
    remaining,
    outcomeControls,
    name = (id) => id,
    checkingOutcome = false,
}: {
    plan: ReleasePlan | null | undefined;
    remaining?: string[];
    outcomeControls?: ReactNode;
    name?: (id: string) => string;
    checkingOutcome?: boolean;
}) {
    if (!plan) return null;

    const reasons = remaining ?? releaseHolds(plan);
    const unfinished = reasons.filter((reason) => /^Its build .+ isn't Done\.$/.test(reason));
    const left = reasons
        .filter((reason) => !unfinished.includes(reason))
        .map((reason) => {
            const step = plan.steps.find((step) => reason.startsWith(`Release step ${step.id}:`));

            if (step) return `${step.what} · ${step.who}`;

            return checkingOutcome && reason.startsWith('Outcome check pending:')
                ? 'Checking Outcome'
                : workHoldReason(reason);
        })
        .map((reason) => reason.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, name));
    const partNames = unfinished.map((reason) =>
        reason
            .replace(/^Its build (.+) isn't Done\.$/, '$1')
            .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, name),
    );
    const outcome = plan.outcomeCheck;

    return (
        <MainSection data-release-steps data-release-progress header={<SectionHeader heading="Release steps" />}>
            <ol className="m-0 grid list-none gap-3 p-0" aria-label="Release steps">
                {plan.steps.map((step) => {
                    const Icon = step.done ? CheckIcon : CircleIcon;

                    return (
                        <li key={step.id} className="flex min-w-0 items-start gap-2 text-sm">
                            <Icon
                                aria-hidden="true"
                                className={`mt-0.5 size-4 shrink-0 ${step.done ? 'text-success-fg' : 'text-fg-muted'}`}
                            />
                            <div className="grid min-w-0 gap-1">
                                <Text as="span" breaks>
                                    {step.what}
                                </Text>
                                {!!step.shipsWith?.length && (
                                    <DetailFact presentation="record" label="Ships with">
                                        <Text as="span" variant="caption" breaks>
                                            {step.shipsWith.map(name).join(' + ')}
                                        </Text>
                                    </DetailFact>
                                )}
                                <Text variant="caption" tone="muted" breaks>
                                    <MetaLine
                                        parts={[
                                            step.who,
                                            step.done ? 'Done' : 'Pending',
                                            step.done && <RecordedAt key="at" evidence={step.done} />,
                                            step.done && step.done.by !== step.who && `recorded by ${step.done.by}`,
                                        ]}
                                    />
                                </Text>
                                {step.done && <Evidence evidence={step.done} />}
                            </div>
                        </li>
                    );
                })}
            </ol>
            <div className="grid min-w-0 gap-1" data-outcome-check>
                <DetailFact label="Outcome check">
                    <Text as="span" breaks>
                        <MetaLine parts={[outcome.what, checkingOutcome ? 'Checking Outcome' : outcome.result]} />
                    </Text>
                </DetailFact>
                {outcome.evidence && (
                    <>
                        <Text variant="caption" tone="muted">
                            <MetaLine
                                parts={[outcome.evidence.by, <RecordedAt key="at" evidence={outcome.evidence} />]}
                            />
                        </Text>
                        <Evidence evidence={outcome.evidence} />
                    </>
                )}
                {outcomeControls}
            </div>
            <DetailFact label="What's left">
                {left.length || partNames.length ? (
                    <ul className="m-0 grid list-disc gap-1 pl-4 text-xs" aria-label="What's left">
                        {left.map((reason) => (
                            <li key={reason}>{reason}</li>
                        ))}
                        {partNames.length > 0 && (
                            <li className="list-none">
                                <Disclosure
                                    label={`${plural(partNames.length, 'part')} not built yet`}
                                    presentation="section"
                                >
                                    <ul className="m-0 grid gap-1 pl-5 text-sm wrap-anywhere">
                                        {partNames.map((title, index) => (
                                            <li key={index}>{title}</li>
                                        ))}
                                    </ul>
                                </Disclosure>
                            </li>
                        )}
                    </ul>
                ) : (
                    'Delivery complete'
                )}
            </DetailFact>
        </MainSection>
    );
}
