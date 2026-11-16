// What names a concept's part wherever it is listed: its status glyph, its kind mark, its title led by its number, and
// where its ticket is saved with its project; the same on its parts-list row and in the concept's attention lists.

import type { Item } from '@lar-factory/shared';
import { itemName, repoKey } from '@lar-factory/shared';

import { PartTitle } from './PartTitle';
import { PartSource, RowKindMark } from './RowIdentity';
import { ItemStatusGlyph } from '@/features/items';
import { RowGlyph, RowTitle, RowTitleCell } from '@/ui/board';

/** A part's status glyph, its source and project (PartSource), then its kind mark and PartTitle. `home` is the concept's own repository,
 *  which a part in it names quietly. */
export function PartIdentity({ item, home }: { item: Item; home: string | undefined }) {
    return (
        <>
            <RowGlyph>
                <ItemStatusGlyph item={item} />
            </RowGlyph>
            <RowTitleCell>
                <PartSource item={item} home={home !== undefined && repoKey(item) === home} />
                <RowKindMark item={item} />
                <RowTitle name={itemName(item)}>
                    <PartTitle item={item} />
                </RowTitle>
            </RowTitleCell>
        </>
    );
}
