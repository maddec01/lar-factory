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
                        // Its number beside the pull request icon; the state beside it says merged, closed or draft.
                        label={`#${pr.number}`}
                        title={prLabel(pr)}
                        // Its checks while it has some; else where it stands, so the card always says one state.
                        checks={
                            pr.state !== 'open' ? (
                                <PullRequestState state={pr.state} />
                            ) : state ? (
                                <ChecksState state={state} />
                            ) : (
                                <PullRequestState state={pr.isDraft ? 'draft' : 'open'} />
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
