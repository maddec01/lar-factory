// The item dialog's pull requests, each with its checks and readiness.

import { checkState, prLabel } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { ChecksState, PullRequestList, PullRequestRow } from '@lar-works/design-system';

import { PrReadiness } from './PrReadiness';

export function PrList({ item }: { item: Item }) {
    return (
        <PullRequestList>
            {item.linkedPrs.map((pr) => {
                const state = pr.checks && checkState(pr.checks);

                return (
                    <PullRequestRow
                        key={pr.number}
                        href={pr.url}
                        label={prLabel(pr)}
                        checks={state && <ChecksState state={state} />}
                        readiness={<PrReadiness item={item} pr={pr} />}
                    />
                );
            })}
        </PullRequestList>
    );
}
