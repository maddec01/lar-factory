// The item dialog: every item, wherever it's listed, opens here over the page, as the design system's workspace-sized
// Modal, whose body fades at its scrolled edges. Under its title it shows the item's repository, status and parent, with
// the agent work figures beside the title. Its body has a progress bar with the slices as an overview, its hint, a meta area of
// people, labels, dates, milestone or iteration and area, its archived and earlier shaping threads, then its work record's brief, map or decision, and its ticket's
// description and comments as ticket context; work with no ticket shows its record alone. The work it waits on,
// sub-tickets and pull requests sit in a sidebar beside them when the dialog is 45rem wide, else between the description and the
// comments. Work that needs you shows why above the meta area, with the board's choices for it, beside any problem cleaning up
// its shaping threads. The board's fields show at
// once; the description, comments and people load when it opens. Its footer has GitHub, or Azure DevOps for a work
// item, Open thread on its latest thread unless that is the action, and the one action the item's status asks for, with
// Move to List and Abandon at its left. A concept also lists its parts, each opening its own details. Its description has
// Edit, and its header an expand control that grows it, the open editor taking the height. Closing it
// or opening a part with unsaved edits asks "Discard changes?" first.

import type { BoardData, Item } from '@lar-factory/shared';
import { Modal, useModalClose } from '@lar-works/design-system';
import { type ComponentProps, useEffect } from 'react';

import { ItemDialogContent } from './ItemDialogContent';
import { useItemDialogStore } from './ItemDialogStore';
import { useDescriptionEdit } from './useDescriptionEdit';
import { useBoardStore } from '@/services/board/board.hooks';
import { useItemDetails } from '@/services/items/items.hooks';
import { useExpand } from '@/shared/dialogs/useExpand';

/** Store dismissal and part navigation share the Modal’s guard and its one discard question. */
function GuardedContent(props: Omit<ComponentProps<typeof ItemDialogContent>, 'openPart'>) {
    const requestClose = useModalClose();

    useEffect(() => {
        useItemDialogStore.setState({ dismiss: () => requestClose() });

        return () => useItemDialogStore.setState({ dismiss: null });
    }, [requestClose]);

    return (
        <ItemDialogContent
            {...props}
            openPart={(itemId) => requestClose(() => useItemDialogStore.getState().open(itemId))}
        />
    );
}

/** The dialog on one item, which holds its details, its description edit and its size until it closes. */
function ItemModal({ item, data, now, close }: { item: Item; data: BoardData; now: number; close: () => void }) {
    const { read, refresh } = useItemDetails(item.id, item.updatedAt);
    const edit = useDescriptionEdit(item.id, read, refresh);
    const [expanded, toggleExpanded] = useExpand();

    return (
        <Modal
            dirty={edit.dirty}
            discardLabels={{
                consequence: 'Your edits to the description haven’t been saved.',
                confirmLabel: 'Discard',
            }}
            onClose={close}
            loading={edit.saving}
        >
            <GuardedContent
                item={item}
                data={data}
                now={now}
                read={read}
                edit={edit}
                refresh={refresh}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
            />
        </Modal>
    );
}

export function ItemDialog() {
    const { data, now } = useBoardStore();
    const { itemId, session, close } = useItemDialogStore();
    const item = data.items.find((i) => i.id === itemId);

    // An item that left the board closes the dialog for good, so a later read that brings it back doesn't reopen it.
    useEffect(() => {
        if (itemId && !item) close();
    }, [itemId, item, close]);

    if (!item) return null;

    return <ItemModal key={session} item={item} data={data} now={now} close={close} />;
}
