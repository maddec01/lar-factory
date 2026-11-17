// The item dialog's pull requests, each with its checks and readiness, the item's recorded checks inside the first's card.

import { checkState, prLabel } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { checksStale } from './PrChecks';
import { PrReadiness } from './PrReadiness';
import { useBoardStore } from '@/services/board/board.hooks';
import { ChecksState, PullRequestList, PullRequestRow, PullRequestState, StaleChecks } from '@/ui/board';

/** `checks` are the item's recorded checks, which sit inside its first pull request's card. */
export function PrList({ item, checks }: { item: Item; checks?: ReactNode }) {
    const data = useBoardStore((state) => state.data);
    const disconnected = useBoardStore((state) => !!state.clientError);

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
                        // Its checks while it has some, with their counts, dimmed while the board can't vouch for them;
                        // else where it stands, so the card always says one state.
                        checks={
                            pr.state !== 'open' ? (
                                <PullRequestState state={pr.state} />
                            ) : state && pr.checks ? (
                                <StaleChecks stale={checksStale(item, pr, data, disconnected)}>
                                    <ChecksState state={state} counts={`${pr.checks.passed}/${pr.checks.total}`} />
                                </StaleChecks>
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
