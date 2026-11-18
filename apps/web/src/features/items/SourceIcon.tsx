// Where an item's ticket is saved, as the design system's SourceIcon: a corner tab on map cards, a bordered square in
// rows and details. While every project saves to GitHub, a GitHub ticket's mark would say the same thing everywhere, so
// it shows only where `always` asks for it (rows, List and the item dialog's header); Azure DevOps and local work always show theirs.

import { onAzure, trackerCapabilities, type Item } from '@lar-factory/shared';

import { useBoardStore } from '@/services/board/board.hooks';
import { SourceIcon as DesignSourceIcon } from '@/ui/board';

/** The ticket determines the source, including when its provider's details haven't loaded yet. */
export function SourceIcon({
    item,
    corner = false,
    bare = false,
    always = false,
}: {
    item: Pick<Item, 'number' | 'repo'> & Partial<Pick<Item, 'sync'>>;
    corner?: boolean;
    bare?: boolean;
    always?: boolean;
}) {
    const mixed = useBoardStore((state) => state.data.repos.some((repo) => onAzure(repo.repo)));
    const tracker = trackerCapabilities(item.repo);
    const source = item.number ? tracker.icon : 'local';

    if (source === 'github' && !mixed && !always) return null;

    // Planning that hasn't reached the tracker changes nothing the row asks of you, so only the tooltip says so.
    const text = `${item.number ? `${tracker.name} ${tracker.ticket}. Saved ${tracker.place}.` : 'Saved only on this machine.'}${item.sync && item.sync.state !== 'saved' ? ' Planning is saved on this Mac.' : ''}`;

    return <DesignSourceIcon source={source} label={text} corner={corner} bare={bare} />;
}
