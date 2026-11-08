// The item dialog's pull requests, each with its checks and readiness, the item's recorded checks inside the first's card.

import { checkState, prLabel } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { PrReadiness } from './PrReadiness';
import { ChecksState, PullRequestList, PullRequestRow, PullRequestState } from '@/ui/board';

/** `checks` are the item's recorded checks, which sit inside its first pull request's card. */
export function PrList({ item, checks }: { item: Item; checks?: ReactNode }) {
    return (
        <PullRequestList>
            {item.linkedPrs.map((pr, index) => {
                const state = pr.checks && checkState(pr.checks);

                return (
                    <PullRequestRow
                        key={pr.number}
                        href={pr.url}
                        label={prLabel(pr).replace(/ \(merged\)$/i, '')}
                        checks={
                            pr.state === 'merged' ? (
                                <PullRequestState state="merged" />
                            ) : (
                                state && <ChecksState state={state} />
                            )
                        }
                        readiness={<PrReadiness item={item} pr={pr} />}
                        details={index === 0 ? checks : undefined}
                    />
                );
            })}
        </PullRequestList>
    );
}
