// Where an item's ticket is saved, as the design system's SourceIcon: a corner tab on map cards, a bordered square in
// rows and details.

import { onAzure, type Item } from '@lar-factory/shared';
import { SourceIcon as DesignSourceIcon } from '@lar-works/design-system';

const SOURCE_TEXT = {
    github: 'GitHub issue. Saved on GitHub.',
    azure: 'Azure DevOps work item. Saved in Azure DevOps.',
    local: 'Saved only on this machine.',
};

/** The ticket determines the source, including when its provider's details haven't loaded yet. */
export function SourceIcon({
    item,
    corner = false,
}: {
    item: Pick<Item, 'number' | 'repo' | 'azure'> & Partial<Pick<Item, 'sync'>>;
    corner?: boolean;
}) {
    const source = !item.number ? 'local' : item.azure || onAzure(item.repo) ? 'azure' : 'github';
    // Planning that hasn't reached the tracker changes nothing the row asks of you, so only the tooltip says so.
    const text = `${SOURCE_TEXT[source]}${item.sync && item.sync.state !== 'saved' ? ' Planning is saved on this Mac.' : ''}`;

    return <DesignSourceIcon source={source} label={text} corner={corner} />;
}
