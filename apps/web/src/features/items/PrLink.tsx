// The provider link stays separate from the in-board merge confirmation. Shared item presentation selects the
// delivery PR; a missing link stays disabled with an explanation.

import { itemPr, mergeStageProblem } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Button, ButtonLink } from '@lar-works/design-system';

import { ICON } from './ButtonIcons';
import { MergePr } from './MergePr';
import { useButtonKind } from '@/ui/board';

/** `next` draws it as a desk card's next step, tinted. */
function PrLink({
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

/** Ready to merge opens an in-board confirmation; Open PR remains a separate link. */
export function PrAction({
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
    if (mergeStageProblem(item))
        return <PrLink item={item} label={label === 'Merge PR' ? 'Open PR' : label} primary={primary} next={next} />;

    const openPr = <PrLink item={item} label="Open PR" />;

    return (
        <>
            <MergePr item={item} label={label} primary={primary} next={next} openPr={openPr} />
            {openPr}
        </>
    );
}
