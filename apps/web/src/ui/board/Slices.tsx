// A piece of work's slices: the bar every view of the board draws, and a list with each slice's mark.

import { ambientMotion, statusStateColors } from '@lar-works/design-system';
import { CheckIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { type SliceProgress, sliceProgressLabel, sliceProgressState } from './StatusColors';

export type { SliceProgress };

const SLICE_COLOR = Object.fromEntries(
    Object.entries(sliceProgressState).map(([progress, state]) => [progress, statusStateColors[state]]),
) as Record<SliceProgress, string>;

/** A 6px segment for each slice, named by its tooltip; waiting segments are faint, and an active one pulses unless
 *  `still`. */
export function SliceBar({
    slices,
    still = false,
}: {
    /** The slices, each with its name and state. */
    slices: { name: string; progress: SliceProgress }[];
    /** Keeps an active segment from pulsing. */
    still?: boolean;
}) {
    if (!slices.length) return null;

    return (
        <ol className="m-0 flex list-none gap-0.5 p-0">
            {slices.map((s, i) => (
                <li
                    key={i}
                    ref={s.progress === 'active' && !still ? ambientMotion : undefined}
                    title={s.name}
                    className={`h-1.5 flex-1 rounded-full ${s.progress === 'active' && !still ? 'status-pulse' : ''}`}
                    style={{ background: SLICE_COLOR[s.progress] }}
                />
            ))}
        </ol>
    );
}

/** A slice's state as a ring: ticked when done, a question mark when unknown, a dot pulsing unless `still` while
 *  active. */
export function SliceMark({
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
            className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]"
            style={{
                borderColor: SLICE_COLOR[progress],
                background: progress === 'done' ? SLICE_COLOR.done : 'transparent',
            }}
        >
            {progress === 'unknown' && <span className="text-[9px] leading-none">?</span>}
            {progress === 'done' && <CheckIcon className="size-2.5 text-white" strokeWidth={3} />}
            {progress === 'active' && (
                <span
                    ref={still ? undefined : ambientMotion}
                    className={`${still ? '' : 'status-pulse '}size-1.5 bg-board-active rounded-full`}
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

/** A slice in SliceList: where its ticket is saved, its mark, number, title (muted when done) and state, in its
 *  state's word (`label`, such as "Queued" for a slice not started). */
export function SliceRow({
    source,
    progress,
    still = false,
    number,
    title,
    label = sliceProgressLabel[progress],
}: {
    /** Where its ticket is saved, a SourceIcon. */
    source: ReactNode;
    /** The slice's state, which picks its mark. */
    progress: SliceProgress;
    /** Keeps an active slice's mark from pulsing. */
    still?: boolean;
    /** The slice's ticket number; a slice with none shows none. */
    number?: number | undefined;
    /** The slice's title. */
    title: string;
    /** The slice's state in words: Done, Working, Blocked, Unknown or Queued (a slice not started) unless given. */
    label?: string | undefined;
}) {
    return (
        <li className="text-ui hover:bg-fill-hover flex items-start gap-2 rounded-md px-2 py-1">
            <span className="mt-0.5">
                <SliceMark progress={progress} still={still} />
            </span>
            {source}
            {!!number && <span className="text-fg-muted shrink-0 tabular-nums">#{number}</span>}
            <span
                className={`min-w-0 flex-1 wrap-anywhere ${progress === 'done' ? 'text-fg-muted' : progress === 'active' ? 'font-medium' : ''}`}
            >
                {title}
            </span>
            <span className="text-2xs text-fg-muted mt-px shrink-0" data-slice-state>
                {label}
            </span>
        </li>
    );
}
