// A pull request's pipeline: its checks as the board's segmented track, the same look as a row's slices, so a build in
// review shows at a glance whether its checks still run, failed or all passed and the PR is ready to merge.

import { SegmentedProgress, statusStateColors } from '@lar-works/design-system';
import type { StatusState } from '@lar-works/design-system';
import { GitPullRequest } from '@lar-works/design-system/icons';

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
            <SegmentedProgress
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

/** The checks as a card's mini track: its `step` (such as "Verify"), then the pull request's mark with `word` (such as
 *  "1 failed"), in the danger colour when a check failed, so the PR's state reads at a glance. */
export function CardChecks({ checks, step, word }: { checks: CheckCounts; step: string; word: string }) {
    const summary = checksSummary(checks);

    return (
        <span className="text-fg-muted inline-flex items-center gap-2 text-xs" title={summary}>
            <span aria-hidden="true">{step}</span>
            <span
                aria-hidden="true"
                className={`inline-flex items-center gap-1 ${checks.failed ? 'text-danger-fg' : ''}`}
                data-checks-word
            >
                <GitPullRequest className="size-3.5" />
                {word}
            </span>
            <span role="img" aria-label={summary} className="inline-flex items-center gap-0.5" data-checks-track>
                {segmentStates(checks).map((state, i) => (
                    <span
                        key={i}
                        className={`h-1 w-2 rounded-full ${state === 'off' ? 'bg-track' : ''} ${state === 'active' ? 'motion-safe:animate-pulse' : ''}`}
                        style={state === 'off' ? undefined : { background: statusStateColors[state] }}
                    />
                ))}
            </span>
        </span>
    );
}
