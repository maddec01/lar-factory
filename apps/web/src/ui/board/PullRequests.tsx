// A piece of work's pull requests: a list with each one's checks and readiness, and the short reference rows show.

import { StatusIndicator } from '@lar-works/design-system';
import { GitPullRequestIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

/** The pull requests in a list, one PullRequestRow each. */
export function PullRequestList({
    children,
}: {
    /** The pull requests, one PullRequestRow each. */
    children: ReactNode;
}) {
    return <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-1 p-0">{children}</ul>;
}

/** A pull request: its icon and label linking to it in a new tab, then its `checks` and `readiness`, and any `details`
 *  at the card's foot, so what belongs to the pull request stays inside its card. */
export function PullRequestRow({
    href,
    label,
    checks,
    readiness,
    details,
}: {
    /** The pull request's page, opened in a new tab. */
    href: string;
    /** The pull request's label, such as `#42`. */
    label: string;
    /** Its checks, a ChecksState, or where it ended, a PullRequestState. */
    checks?: ReactNode;
    /** Its readiness, a PullRequestReadiness. */
    readiness?: ReactNode;
    /** More about its work, such as a Checks disclosure, across the card's foot. */
    details?: ReactNode;
}) {
    return (
        <li className="border-line bg-surface-raised flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2">
            <GitPullRequestIcon className="stroke-board-done size-4 shrink-0" />
            <a
                href={href}
                target="_blank"
                rel="noopener"
                className="min-w-0 flex-1 basis-24 font-medium wrap-anywhere hover:underline"
            >
                {label}
            </a>
            {checks}
            {readiness}
            {details && <div className="min-w-0 basis-full">{details}</div>}
        </li>
    );
}

// Running checks are work under way, so they take the active state's blue, as the board's rows and glyphs draw them.
const CHECKS_LIGHT = {
    failed: { state: 'failed' },
    running: { state: 'active' },
    passed: { state: 'ready', color: 'var(--color-board-done)' },
} as const;

/** A pull request's checks as a status light and their state, then any `counts`. */
export function ChecksState({
    state,
    counts,
}: {
    /** How the checks stand, which picks their light. */
    state: keyof typeof CHECKS_LIGHT;
    /** How many passed, failed and run, in words. */
    counts?: string;
}) {
    const light: { state: 'failed' | 'active' | 'ready'; color?: string } = CHECKS_LIGHT[state];

    return (
        <span className="text-fg-muted inline-flex shrink-0 items-center gap-1.5 text-xs">
            <StatusIndicator size="sm" state={light.state} labelColor={light.color} />
            Checks {state}
            {counts && <span className="tabular-nums">· {counts}</span>}
        </span>
    );
}

/** Where a pull request ended, in place of its checks: `merged` in the board's done colour, `closed` off. */
const PULL_REQUEST_LIGHT = {
    merged: { state: 'ready', color: 'var(--color-board-done)', words: 'Merged' },
    closed: { state: 'off', words: 'Closed' },
} as const;

/** A merged or closed pull request's state as the status-word rule draws it, ChecksState's look: its light and word,
 *  never a tinted pill. */
export function PullRequestState({
    state,
}: {
    /** Where the pull request ended. */
    state: keyof typeof PULL_REQUEST_LIGHT;
}) {
    const light: { state: 'ready' | 'off'; color?: string; words: string } = PULL_REQUEST_LIGHT[state];

    return (
        <span className="text-fg-muted inline-flex shrink-0 items-center gap-1.5 text-xs">
            <StatusIndicator size="sm" state={light.state} labelColor={light.color} />
            {light.words}
        </span>
    );
}

/** A pull request as a row names it: its icon and short label, `title` naming it in full. */
export function PullRequestRef({
    label,
    title,
}: {
    /** The pull request's short label, such as `#42`. */
    label: string;
    /** The pull request in full, as its tooltip. */
    title?: string;
}) {
    return (
        <span title={title} className="inline-flex shrink-0 items-center gap-1">
            <GitPullRequestIcon className="stroke-board-done size-3 shrink-0" />
            {label}
        </span>
    );
}

/** A pull request's readiness under its row: the `toggle` that shows it, then the `details` while shown. */
export function PullRequestReadiness({
    toggle,
    details,
}: {
    /** The button that shows the readiness. */
    toggle: ReactNode;
    /** The readiness, a ReadinessDetails, while shown. */
    details?: ReactNode;
}) {
    return (
        <div className="text-fg-muted basis-full text-xs">
            {toggle}
            {details}
        </div>
    );
}

/** What a readiness read says: its `status`, when it was `observed` and what blocks it, a `note`, and `refresh`. */
export function ReadinessDetails({
    id,
    status,
    observed,
    blockers = [],
    note,
    refresh,
}: {
    /** The details' id, for the toggle's `aria-controls`. */
    id: string;
    /** What the read says. */
    status: ReactNode;
    /** When the read was made. */
    observed?: ReactNode;
    /** What blocks the merge, a line each. */
    blockers?: string[];
    /** A note on the read. */
    note: ReactNode;
    /** The button that reads again. */
    refresh: ReactNode;
}) {
    return (
        <div id={id} role="status" aria-live="polite">
            <p>{status}</p>
            {observed && (
                <>
                    <p>{observed}</p>
                    <ul>
                        {blockers.map((b) => (
                            <li key={b}>{b}</li>
                        ))}
                    </ul>
                </>
            )}
            <p>{note}</p>
            {refresh}
        </div>
    );
}
