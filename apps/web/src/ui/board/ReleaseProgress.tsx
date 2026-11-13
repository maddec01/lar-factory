import { releaseHolds, type ReleaseEvidence, type ReleasePlan } from '@lar-factory/shared';
import { CopyButton, Text, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { CheckIcon, CircleIcon } from '@lar-works/design-system/icons';

import { DetailFact, MainSection, SectionHeader } from './ItemDetails';

function RecordedAt({ evidence }: { evidence: ReleaseEvidence }) {
    const date = new Date(evidence.at);
    const when = Number.isNaN(date.getTime())
        ? evidence.at
        : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    return (
        <time dateTime={evidence.at} title={evidence.at}>
            {when}
        </time>
    );
}

/** Keep receipts short; pointer and keyboard users can inspect or copy the exact evidence. */
function Evidence({ evidence }: { evidence: ReleaseEvidence }) {
    const hashes = evidence.evidence.replace(/\b[a-f0-9]{64}\b/gi, (hash) => `${hash.slice(0, 12)}…`);
    const short = hashes.length > 160 ? `${hashes.slice(0, 160)}…` : hashes;

    return (
        <div className="text-fg-muted flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            <Tooltip>
                <TooltipTrigger asChild>
                    <span tabIndex={0} className="min-w-0 wrap-anywhere">
                        {short}
                    </span>
                </TooltipTrigger>
                <TooltipPopup>{evidence.evidence}</TooltipPopup>
            </Tooltip>
            <CopyButton label="Copy full release evidence" copiedLabel="Evidence copied" value={evidence.evidence} />
        </div>
    );
}

/** Parent-owned release checklist, shared by the group and its item details. */
export function ReleaseProgress({ plan, remaining }: { plan: ReleasePlan | null | undefined; remaining?: string[] }) {
    if (!plan) return null;

    const left = (remaining ?? releaseHolds(plan)).map((reason) => {
        const step = plan.steps.find((step) => reason.startsWith(`Release step ${step.id}:`));

        return step ? `${step.what} · ${step.who}` : reason;
    });
    const outcome = plan.outcomeCheck;

    return (
        <MainSection data-release-progress header={<SectionHeader heading="Release steps" />}>
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
                                <Text variant="caption" tone="muted" breaks>
                                    {step.who} · {step.done ? 'Done' : 'Pending'}
                                    {step.done && (
                                        <>
                                            {' '}
                                            · <RecordedAt evidence={step.done} />
                                            {step.done.by !== step.who && ` · recorded by ${step.done.by}`}
                                        </>
                                    )}
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
                        {outcome.what} · {outcome.result}
                    </Text>
                </DetailFact>
                {outcome.evidence && (
                    <>
                        <Text variant="caption" tone="muted">
                            {outcome.evidence.by} · <RecordedAt evidence={outcome.evidence} />
                        </Text>
                        <Evidence evidence={outcome.evidence} />
                    </>
                )}
            </div>
            <DetailFact label="What's left">
                {left.length ? (
                    <ul className="m-0 grid list-disc gap-1 pl-4 text-xs" aria-label="What's left">
                        {left.map((reason) => (
                            <li key={reason}>{reason}</li>
                        ))}
                    </ul>
                ) : (
                    'Delivery complete'
                )}
            </DetailFact>
        </MainSection>
    );
}
