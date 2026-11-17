// A piece of work's slices: the bar every view of the board draws (the design system's tick meter), and a list
// with each slice's mark.

import { ambientMotion, statusStateColors, TickMeter } from '@lar-works/design-system';
import { CheckIcon, XIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { COMPACT_ROW } from './RowStyles';
import { MARK_STROKE, type SliceProgress, sliceProgressLabel, sliceProgressState } from './StatusColors';

export type { SliceProgress };

const SLICE_COLOR = Object.fromEntries(
    Object.entries(sliceProgressState).map(([progress, state]) => [progress, statusStateColors[state]]),
) as Record<SliceProgress, string>;

/** A segment for each slice in its state's colour, named for screen readers and, all together, by the bar's tooltip;
 *  an active one breathes unless `still`. `size` is `sm` (4px) on a row and `md` (6px) in the item dialog. A row's
 *  reviewers draw the same bar, with their `noun` and each one's own `word`. */
export function SliceBar({
    slices,
    still = false,
    size = 'sm',
    noun = 'Slices',
}: {
    /** The slices, each with its name, state and any word for that state in place of the slice's. */
    slices: { name: string; progress: SliceProgress; word?: string | undefined }[];
    /** Keeps an active segment from pulsing. */
    still?: boolean;
    /** `sm` on a row (the default), `md` in a dialog. */
    size?: 'sm' | 'md';
    /** What the segments are, for screen readers: Slices unless given. */
    noun?: string;
}) {
    if (!slices.length) return null;

    const done = slices.filter((s) => s.progress === 'done' || s.progress === 'failed').length;
    const named = slices.map((s) => `${s.name}: ${s.word ?? sliceProgressLabel[s.progress]}`);

    return (
        <div className="min-w-0" title={named.join('\n')} data-slice-bar>
            <TickMeter
                label={`${noun}, ${done} of ${slices.length} done`}
                size={size}
                // Done slices fill in the success colour and the active one in the accent, over the grey of what's to come and
                // what's held, as the slice's own row and its grey state say; amber stays for what waits on you.
                segments={slices.map((s, i) => ({
                    label: named[i]!,
                    state: sliceProgressState[s.progress],
                    pulse: s.progress === 'active' && !still,
                }))}
            />
        </div>
    );
}

/** Work that runs with no slices to count, so a row at work always draws a bar. As a scan of unknown size does, a light
 *  travels along the ticks while the thread works, and the ticks stay still once it stops; `waiting`, its thread paused
 *  on you (a question, an approval), the light travels in amber, the colour of what waits on you, and keeps travelling
 *  however long the wait. `label` names what runs, such as "Planning". */
export function WorkingBar({
    label,
    still = false,
    waiting = false,
}: {
    label: string;
    still?: boolean;
    waiting?: boolean;
}) {
    return (
        <div className="min-w-0" title={label} data-slice-bar data-waiting={waiting || undefined}>
            <TickMeter
                label={label}
                segments={[{ label, state: waiting ? 'waiting' : 'active', sweep: waiting || !still }]}
            />
        </div>
    );
}

/** A slice's state as a ring: ticked when done, crossed when failed, a question mark when unknown, a dot pulsing unless
 *  `still` while active, dashed while held by another slice, so blocked never reads as queued. */
function SliceMark({
    progress,
    still = false,
}: {
    /** The slice's state, which picks its ring. */
    progress: SliceProgress;
    /** Keeps an active slice's dot from pulsing. */
    still?: boolean;
}) {
    return (
        <span
            className={`grid size-4 shrink-0 place-items-center rounded-full ${MARK_STROKE} ${progress === 'blocked' ? 'border-dashed' : ''}`}
            style={{
                borderColor: SLICE_COLOR[progress],
                background: progress === 'done' || progress === 'failed' ? SLICE_COLOR[progress] : 'transparent',
            }}
        >
            {progress === 'unknown' && <span className="text-xs leading-none font-semibold">?</span>}
            {progress === 'done' && <CheckIcon className="size-2.5 text-white" strokeWidth={3} />}
            {progress === 'failed' && <XIcon className="size-2.5 text-white" strokeWidth={3} />}
            {progress === 'active' && (
                <span
                    ref={still ? undefined : ambientMotion}
                    className={`${still ? '' : 'lar-status-pulse '}size-1.5 bg-board-active rounded-full`}
                />
            )}
        </span>
    );
}

/** The slices of a piece of work, one SliceRow each. */
export function SliceList({
    children,
}: {
    /** The slices, one SliceRow each. */
    children: ReactNode;
}) {
    return <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">{children}</ul>;
}

/** A slice in SliceList: where its ticket is saved, its mark, its number and title (an ItemTitle, muted when done) and
 *  state, in its state's word (`label`, such as "Queued" for a slice not started). */
export function SliceRow({
    source,
    progress,
    still = false,
    title,
    label = sliceProgressLabel[progress],
}: {
    /** Where its ticket is saved, a SourceIcon. */
    source: ReactNode;
    /** The slice's state, which picks its mark. */
    progress: SliceProgress;
    /** Keeps an active slice's mark from pulsing. */
    still?: boolean;
    /** The slice's number and title, an ItemTitle. */
    title: ReactNode;
    /** The slice's state in words: Done, Working, Blocked, Unknown or Queued (a slice not started) unless given. */
    label?: string | undefined;
}) {
    return (
        <li className={`${COMPACT_ROW} -mx-2 flex items-start gap-2 text-sm`}>
            <span className="mt-0.5">
                <SliceMark progress={progress} still={still} />
            </span>
            <span className="flex h-5 shrink-0 items-center empty:hidden">{source}</span>
            <span
                className={`min-w-0 flex-1 wrap-anywhere ${progress === 'done' ? 'text-fg-muted' : progress === 'active' ? 'font-medium' : ''}`}
            >
                {title}
            </span>
            <span className="text-fg-muted mt-0.5 shrink-0 text-xs" data-slice-state>
                {label}
            </span>
        </li>
    );
}
