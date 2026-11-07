// An item's slices: the slice bar every view draws, and the item dialog's slice list with each slice's mark, on the
// design system's slice parts.

import { itemName } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { SliceBar as DesignSliceBar, SliceList as DesignSliceList, SliceRow } from '@lar-works/design-system';

import { SourceIcon } from './SourceIcon';

/** A 6px segment for each recorded slice; waiting segments are faint. `still` stops an active one pulsing. */
export function SliceBar({ item, still = false }: { item: Item; thick?: boolean; still?: boolean }) {
    return (
        <DesignSliceBar slices={item.slices.map((s) => ({ name: itemName(s), progress: s.progress }))} still={still} />
    );
}

export function SliceList({ item, still = false }: { item: Item; still?: boolean }) {
    return (
        <DesignSliceList>
            {item.slices.map((s, i) => (
                <SliceRow
                    key={i}
                    source={<SourceIcon item={s} />}
                    progress={s.progress}
                    still={still}
                    number={s.number}
                    title={s.title}
                />
            ))}
        </DesignSliceList>
    );
}
