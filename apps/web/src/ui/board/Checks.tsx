// A pull request's pipeline: its checks as the board's segmented track, the same look as a row's slices, so a build in
// review shows at a glance whether its checks still run, failed or all passed and the PR is ready to merge.

import { TickMeter } from '@lar-works/design-system';
import type { StatusState } from '@lar-works/design-system';
import { GitPullRequest } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

/** Counts over a PR's checks. */
export interface CheckCounts {
    passed: number;
    failed: number;
    running: number;
    total: number;
}

/** The most segments a track draws; more checks than that share them in proportion. */
const MOST = 8;

/** Each segment's state in order: failed first, so a failure is never lost at the end, then passed, running, and the
 *  checks nothing reported on. */
function segmentStates({ passed, failed, running, total }: CheckCounts): StatusState[] {
    const scale = total > MOST ? MOST / total : 1;
    const share = (n: number) => (n > 0 ? Math.max(1, Math.round(n * scale)) : 0);
    const states: StatusState[] = [
        ...Array<StatusState>(share(failed)).fill('failed'),
        ...Array<StatusState>(share(passed)).fill('ready'),
        ...Array<StatusState>(share(running)).fill('active'),
    ];
    const length = Math.min(total, MOST);

    while (states.length < length) states.push('off');

    return states.slice(0, Math.max(length, 1));
}

/** The checks in words, for the track's tooltip and screen readers. */
const checksSummary = ({ passed, failed, running, total }: CheckCounts): string =>
    [`${passed} of ${total} checks passed`, failed && `${failed} failed`, running && `${running} running`]
        .filter(Boolean)
        .join(' · ');

/** The checks as a row's track, where a row's slices would be: passed green, running blue and breathing unless
 *  `still`, failed red, unreported grey. */
export function ChecksBar({ checks, still = false }: { checks: CheckCounts; still?: boolean }) {
    const summary = checksSummary(checks);

    return (
        <div className="min-w-0" title={summary} data-checks-bar>
            <TickMeter
                label={summary}
                size="sm"
                segments={segmentStates(checks).map((state, i) => ({
                    label: `Check ${i + 1}`,
                    state,
                    pulse: state === 'active' && !still,
                }))}
            />
        </div>
    );
}

/** Checks the board can't vouch for, `stale`, dimmed with a tooltip that says so, unless `untitled` because the
 *  checks' own tooltip already does; current checks show as they are. */
export function StaleChecks({
    stale,
    untitled = false,
    children,
}: {
    stale: boolean;
    untitled?: boolean;
    children: ReactNode;
}) {
    return stale ? (
        <span
            className="block min-w-0 opacity-50"
            title={untitled ? undefined : 'Stale check observation'}
            data-checks-stale
        >
            {children}
        </span>
    ) : (
        children
    );
}

/** What a card knows of its PR's checks: their counts (`stale` when the board can't vouch they are current), or that
 *  they are still loading, that the PR has none yet, or that the board can't read them. */
export type CardCheckState = CheckCounts | 'loading' | 'none' | 'unavailable';

/** The checks as a card's mini track: its `step` (such as "Verify"), then the pull request's mark with `word` (such as
 *  "1 failed"), in the danger colour when a check failed, then the checks as segments, so the PR's state reads at a
 *  glance. Checks still loading breathe as grey segments; a PR with no checks, or checks the board can't read, shows the
 *  mark with a quiet word and no track; `stale` counts show dimmed. `detail` adds to the tooltip, such as the PR's number
 *  and any warning, so the card itself stays one line. */
export function CardChecks({
    checks,
    step,
    word,
    stale = false,
    detail,
}: {
    checks: CardCheckState;
    step?: string;
    word?: string;
    stale?: boolean;
    detail?: string;
}) {
    const counts = typeof checks === 'object' ? checks : undefined;
    const summary = counts
        ? checksSummary(counts)
        : checks === 'loading'
          ? 'Loading checks…'
          : checks === 'none'
            ? 'No checks yet'
            : 'Checks unavailable';
    const label = [detail, summary, stale && 'Stale check observation'].filter(Boolean).join(' · ');
    const shown = word ?? (checks === 'none' ? 'no checks' : checks === 'unavailable' ? 'unknown' : undefined);
    const segments: { state: StatusState; pulse: boolean }[] = counts
        ? segmentStates(counts).map((state) => ({ state, pulse: state === 'active' && !stale }))
        : checks === 'loading'
          ? Array.from({ length: 3 }, () => ({ state: 'off' as const, pulse: true }))
          : [];

    return (
        <span className="text-fg-muted inline-flex items-center gap-2 text-xs" title={label} data-card-checks>
            {step && <span aria-hidden="true">{step}</span>}
            <span
                aria-hidden="true"
                className={`inline-flex items-center gap-1 ${counts?.failed && !stale ? 'text-danger-fg' : ''}`}
                data-checks-word
            >
                <GitPullRequest className="size-3.5" />
                {shown}
            </span>
            {segments.length > 0 ? (
                // One tick a check (the meter set to that many ticks); checks still loading sweep grey.
                <StaleChecks stale={stale} untitled>
                    <span className="inline-block" style={{ width: segments.length * 7 - 3 }} data-checks-track>
                        <TickMeter
                            label={label}
                            segments={
                                checks === 'loading'
                                    ? [{ label, color: 'var(--color-fg-muted)', sweep: true }]
                                    : segments.map(({ state, pulse }, i) => ({ label: `Check ${i + 1}`, state, pulse }))
                            }
                        />
                    </span>
                </StaleChecks>
            ) : (
                <span className="sr-only">{label}</span>
            )}
        </span>
    );
}
