// An Open that opens an item's pull request on GitHub, where it's verified and merged: the PR its issue links first,
// or the item itself when it is a pull request. Disabled, its title saying why, while there is none.

import { itemPr } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Button, ButtonLink } from '@lar-works/design-system';

import { ICON } from './ButtonIcons';
import { useButtonKind } from '@/ui/board';

/** `next` draws it as a desk card's next step, tinted. */
export function PrLink({
    item,
    label,
    primary = false,
    next = false,
}: {
    item: Item;
    label: string;
    primary?: boolean;
    next?: boolean;
}) {
    const kindOf = useButtonKind();
    const kind = primary ? 'main' : next ? 'next' : 'open';

    const url = itemPr(item)?.url;

    // Pointer events stay on while it's disabled (the board's base styles), so its title says why.
    if (!url)
        return (
            <Button
                {...kindOf(kind)}
                leftIcon={ICON.pr}
                data-pr-link={item.id}
                disabled
                title="No pull request is linked to this item yet"
            >
                {label}
            </Button>
        );

    return (
        <ButtonLink
            look="app"
            {...kindOf(kind)}
            icon={ICON.pr}
            data-pr-link={item.id}
            href={url}
            target="_blank"
            rel="noopener"
        >
            {label}
        </ButtonLink>
    );
}
