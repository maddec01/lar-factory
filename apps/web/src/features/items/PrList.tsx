// The item dialog's pull requests, each with its checks and readiness.

import { checkState, prLabel } from '@lar-factory/shared';
import type { Checks, Item } from '@lar-factory/shared';
import { GitPullRequest } from '@lar-works/design-system/icons';

import { PrReadiness } from './PrReadiness';

const CHECKS_COLOR = { failed: 'var(--error)', running: 'var(--warning)', passed: 'var(--st-done)' } as const;

/** A pull request's checks as a coloured dot and their state, with the passed count when `counts`; nothing when it has none. */
function ChecksBadge({ checks, counts }: { checks: Checks | null; counts?: boolean }) {
    const state = checkState(checks);

    if (!checks || !state) return null;

    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-(--muted-foreground)">
            <span className="size-2 rounded-full" style={{ background: CHECKS_COLOR[state] }} />
            checks {state}
            {counts && (
                <span className="tabular-nums">
                    · {checks.passed}/{checks.total} passed
                </span>
            )}
        </span>
    );
}

export function PrList({ item }: { item: Item }) {
    return (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-1 p-0">
            {item.linkedPrs.map((pr) => (
                <li
                    key={pr.number}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-(--border) bg-(--card) px-3 py-2"
                >
                    <GitPullRequest className="size-4 shrink-0 text-(--st-done)" />
                    <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener"
                        className="min-w-0 flex-1 basis-24 font-medium wrap-anywhere hover:underline"
                    >
                        {prLabel(pr)}
                    </a>
                    <ChecksBadge checks={pr.checks} />
                    <PrReadiness item={item} pr={pr} />
                </li>
            ))}
        </ul>
    );
}
