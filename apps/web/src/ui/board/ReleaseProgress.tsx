import { releaseHolds, type ReleasePlan } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';

import { DetailFact, FactList, MainSection, SectionHeader } from './ItemDetails';

/** Parent-owned delivery steps use the same readable facts in the group and item details. */
export function ReleaseProgress({ plan, remaining }: { plan: ReleasePlan | null | undefined; remaining?: string[] }) {
    if (!plan) return null;

    const left = remaining ?? releaseHolds(plan);

    return (
        <MainSection data-release-progress header={<SectionHeader heading="Release steps" />}>
            <FactList>
                {plan.steps.map((step, index) => (
                    <DetailFact key={step.id} label={`${index + 1}. ${step.who}`}>
                        <Text as="span" breaks>
                            {step.what} · {step.done ? 'Done' : 'Pending'}
                        </Text>
                        {step.done && (
                            <Text variant="caption" tone="muted" breaks>
                                {step.done.evidence} · {step.done.by}
                            </Text>
                        )}
                    </DetailFact>
                ))}
                <DetailFact label="Outcome check">
                    <Text as="span" breaks>
                        {plan.outcomeCheck.what} · {plan.outcomeCheck.result}
                    </Text>
                    {plan.outcomeCheck.evidence && (
                        <Text variant="caption" tone="muted" breaks>
                            {plan.outcomeCheck.evidence.evidence} · {plan.outcomeCheck.evidence.by}
                        </Text>
                    )}
                </DetailFact>
                <DetailFact label="What's left">
                    {left.length
                        ? left.map((reason) => (
                              <Text key={reason} variant="caption" breaks>
                                  {reason}
                              </Text>
                          ))
                        : 'Delivery complete'}
                </DetailFact>
            </FactList>
        </MainSection>
    );
}
