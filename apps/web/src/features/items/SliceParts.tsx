// An item's slices: the slice bar every view draws, and the item dialog's slice list with each slice's mark.

import { itemName } from '@lar-factory/shared';
import type { Item, SliceProgress } from '@lar-factory/shared';
import { ambientMotion } from '@lar-works/design-system';
import { Check } from '@lar-works/design-system/icons';

import { SourceIcon } from './SourceIcon';

const SLICE_COLOR: Record<SliceProgress, string> = {
    done: 'var(--st-done)',
    active: 'var(--st-now)',
    blocked: 'var(--st-review)',
    unknown: 'var(--muted-foreground)',
    waiting: 'var(--input)',
};

/** A 6px segment for each recorded slice; waiting segments are faint. `still` stops an active one pulsing. */
export function SliceBar({ item, still = false }: { item: Item; thick?: boolean; still?: boolean }) {
    if (!item.slices.length) return null;

    return (
        <ol className="m-0 flex list-none gap-[2px] p-0">
            {item.slices.map((s, i) => (
                <li
                    key={i}
                    ref={s.progress === 'active' && !still ? ambientMotion : undefined}
                    title={itemName(s)}
                    className={`h-1.5 flex-1 rounded-full ${s.progress === 'active' && !still ? 'status-pulse' : ''}`}
                    style={{ background: s.progress === 'waiting' ? 'var(--soft)' : SLICE_COLOR[s.progress] }}
                />
            ))}
        </ol>
    );
}

/** A slice's state as a ring: ticked when done, a pulsing dot while active. */
export function SliceMark({ progress, still = false }: { progress: SliceProgress; still?: boolean }) {
    return (
        <span
            className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]"
            style={{
                borderColor: SLICE_COLOR[progress],
                background: progress === 'done' ? 'var(--st-done)' : 'transparent',
            }}
        >
            {progress === 'unknown' && <span className="text-[9px] leading-none">?</span>}
            {progress === 'done' && <Check className="size-2.5 text-white" strokeWidth={3} />}
            {progress === 'active' && (
                <span
                    ref={still ? undefined : ambientMotion}
                    className={`${still ? '' : 'status-pulse '}size-1.5 rounded-full bg-(--st-now)`}
                />
            )}
        </span>
    );
}

export function SliceList({ item, still = false }: { item: Item; still?: boolean }) {
    return (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
            {item.slices.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-(--soft)">
                    <SourceIcon item={s} />
                    <span className="mt-0.5">
                        <SliceMark progress={s.progress} still={still} />
                    </span>
                    {s.number > 0 && (
                        <span className="shrink-0 text-(--muted-foreground) tabular-nums">#{s.number}</span>
                    )}
                    <span
                        className={`min-w-0 flex-1 wrap-anywhere ${s.progress === 'done' ? 'text-(--muted-foreground) line-through' : s.progress === 'active' ? 'font-medium' : ''}`}
                    >
                        {s.title}
                    </span>
                    <span className="mt-px shrink-0 text-[11px] text-(--muted-foreground)">{s.progress}</span>
                </li>
            ))}
        </ul>
    );
}
