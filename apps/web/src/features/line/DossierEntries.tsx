// The entries of a dossier's rows: text whose references open their items, and a part's name and link.

import { itemName } from '@lar-factory/shared';
import { PartLink as DesignPartLink, PartName as DesignPartName, RefButton } from '@lar-works/design-system';

import { open } from './DossierHelpers';
import type { FindRef } from './DossierHelpers';
import type { Part } from './DossierParts';
import { ItemTitle, SourceIcon, ItemStatusGlyph } from '@/features/items';

/** Text with its `#n` and `owner/repo#n` references as buttons that open the item. */
export function Refs({ text, find }: { text: string; find: FindRef }) {
    return text.split(/((?:[\w.-]+\/[\w.-]+)?#\d+)/).map((bit, n) => {
        const ref = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/.exec(bit);
        const item = ref ? find(ref[1], Number(ref[2])) : undefined;

        return item ? (
            <RefButton key={n} title={item.title} onOpen={() => open(item)}>
                {bit}
            </RefButton>
        ) : (
            bit
        );
    });
}

/** A part's source, status and title, up to two lines. */
export function PartName({ part }: { part: Part }) {
    return (
        <DesignPartName source={<SourceIcon item={part.item} />} glyph={<ItemStatusGlyph item={part.item} />}>
            <ItemTitle item={part.item} />
        </DesignPartName>
    );
}

/** A part as a link to its item dialog. */
export function PartLink({ part }: { part: Part }) {
    return (
        <DesignPartLink title={itemName(part.item)} onOpen={() => open(part.item)}>
            <PartName part={part} />
        </DesignPartLink>
    );
}
