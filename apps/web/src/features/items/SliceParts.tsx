// An item's slices: the slice bar every view draws, and the item dialog's slice list with each slice's mark, on the
// design system's slice parts.

import { itemName } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { shownSliceProgress } from './SliceProgress';
import { SourceIcon } from './SourceIcon';
import { SliceBar as DesignSliceBar, SliceList as DesignSliceList, ItemTitle, SliceRow } from '@/ui/board';

/** A segment for each recorded slice, 4px on a row and 6px `thick` in the item dialog. `still` stops an active one
 *  pulsing. */
export function SliceBar({ item, thick = false, still = false }: { item: Item; thick?: boolean; still?: boolean }) {
    return (
        <DesignSliceBar
            slices={item.slices.map((s) => ({ name: itemName(s), progress: shownSliceProgress(item, s.progress) }))}
            still={still}
            size={thick ? 'md' : 'sm'}
        />
    );
}

export function SliceList({ item, still = false }: { item: Item; still?: boolean }) {
    return (
        <DesignSliceList>
            {item.slices.map((s, i) => (
                <SliceRow
                    key={i}
                    source={<SourceIcon item={s} bare />}
                    progress={shownSliceProgress(item, s.progress)}
                    still={still}
                    title={<ItemTitle reference={s.number ? `#${s.number}` : undefined} title={s.title} />}
                />
            ))}
        </DesignSliceList>
    );
}
