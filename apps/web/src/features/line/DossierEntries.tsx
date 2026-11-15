// The entries of a dossier's rows: text whose references open their items, and a part's name and link.

import { open } from './DossierHelpers';
import type { FindRef } from './DossierHelpers';
import type { Part } from './DossierParts';
import { PartIdentity } from './PartIdentity';
import { ItemTitle, PartLink as DesignPartLink } from '@/ui/board';

/** Text with its `#n` and `owner/repo#n` references as buttons that open the item. */
export function Refs({ text, find }: { text: string; find: FindRef }) {
    return text
        .replace(/(#\d+)\s+\)/g, '$1)')
        .split(/((?:[\w.-]+\/[\w.-]+)?#\d+)/)
        .map((bit, n) => {
            const ref = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/.exec(bit);
            const item = ref ? find(ref[1], Number(ref[2])) : undefined;

            return item ? <ItemTitle key={n} reference={bit} name={item.title} onOpen={() => open(item)} /> : bit;
        });
}

/** A part as a link to its item dialog, named as its parts-list row names it; `home` is the concept's own repository. */
export function PartLink({ part, home }: { part: Part; home: string }) {
    return (
        <DesignPartLink onOpen={() => open(part.item)}>
            <PartIdentity item={part.item} home={home} />
        </DesignPartLink>
    );
}
