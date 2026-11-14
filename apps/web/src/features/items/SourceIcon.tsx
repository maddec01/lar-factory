// Where an item's ticket is saved, as the design system's SourceIcon: a corner tab on map cards, a bordered square in
// rows and details. While every project saves to GitHub, a GitHub ticket's mark would say the same thing everywhere, so
// it shows only where `always` asks for it (rows, List and the item dialog's header); Azure DevOps and local work always show theirs.

import { onAzure, type Item } from '@lar-factory/shared';

import { useBoardStore } from '@/services/board/board.hooks';
import { SourceIcon as DesignSourceIcon } from '@/ui/board';

const SOURCE_TEXT = {
    github: 'GitHub issue. Saved on GitHub.',
    azure: 'Azure DevOps work item. Saved in Azure DevOps.',
    local: 'Saved only on this machine.',
};

/** The ticket determines the source, including when its provider's details haven't loaded yet. */
export function SourceIcon({
    item,
    corner = false,
    bare = false,
    always = false,
}: {
    item: Pick<Item, 'number' | 'repo' | 'azure'> & Partial<Pick<Item, 'sync'>>;
    corner?: boolean;
    bare?: boolean;
    always?: boolean;
}) {
    const mixed = useBoardStore((state) => state.data.repos.some((repo) => onAzure(repo.repo)));
    const source = !item.number ? 'local' : item.azure || onAzure(item.repo) ? 'azure' : 'github';

    if (source === 'github' && !mixed && !always) return null;

    // Planning that hasn't reached the tracker changes nothing the row asks of you, so only the tooltip says so.
    const text = `${SOURCE_TEXT[source]}${item.sync && item.sync.state !== 'saved' ? ' Planning is saved on this Mac.' : ''}`;

    return <DesignSourceIcon source={source} label={text} corner={corner} bare={bare} />;
}
