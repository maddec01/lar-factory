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
import { Button, Modal } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import { ItemDialogContent } from './ItemDialogContent';
import { useItemDialogStore } from './ItemDialogStore';
import { useDescriptionEdit } from './useDescriptionEdit';
import { useItemDetails } from './useItemDetails';
import { useBoardStore } from '@/services/board/board.hooks';
import { kind } from '@/shared/ui/buttons/ButtonKinds';
import { useExpand } from '@/shared/ui/expand-dialog/ExpandDialog';

/** Asks before closing the dialog drops unsaved edits to the description. */
function DiscardPrompt({ keep, discard }: { keep: () => void; discard: () => void }) {
    return (
        <Modal onClose={keep}>
            <Modal.Content title="Discard changes?" description="Your edits to the description haven't been saved.">
                <Modal.Footer>
                    <Button {...kind('other')} onClick={keep}>
                        Keep editing
                    </Button>
                    <Button {...kind('main', 'danger')} onClick={discard}>
                        Discard
                    </Button>
                </Modal.Footer>
            </Modal.Content>
        </Modal>
    );
}

/** The dialog on one item, which holds its details, its description edit and its size until it closes. */
function ItemModal({ item, data, now, close }: { item: Item; data: BoardData; now: number; close: () => void }) {
    const { read, refresh } = useItemDetails(item.id, item.updatedAt);
    const edit = useDescriptionEdit(item.id, read, refresh);
    const [asking, setAsking] = useState(false);
    /** The part to open once unsaved edits are discarded, rather than closing. */
    const [nextPart, setNextPart] = useState<string | null>(null);
    const [expanded, toggleExpanded] = useExpand(asking);

    useEffect(() => {
        useItemDialogStore.setState({
            dismiss: () => {
                if (!edit.saving) {
                    if (edit.dirty) setAsking(true);
                    else close();
                }
            },
        });

        return () => {
            useItemDialogStore.setState({ dismiss: null });
        };
    }, [edit.saving, edit.dirty, close]);

    const openPart = (itemId: string) => {
        if (edit.saving) return;

        if (!edit.dirty) useItemDialogStore.getState().open(itemId);
        else {
            setNextPart(itemId);
            setAsking(true);
        }
    };

    return (
        <>
            <Modal onClose={() => (edit.dirty ? setAsking(true) : close())} loading={edit.saving}>
                <ItemDialogContent
                    item={item}
                    data={data}
                    now={now}
                    read={read}
                    edit={edit}
                    refresh={refresh}
                    expanded={expanded}
                    toggleExpanded={toggleExpanded}
                    openPart={openPart}
                />
            </Modal>
            {asking && (
                <DiscardPrompt
                    keep={() => {
                        setAsking(false);
                        setNextPart(null);
                    }}
                    discard={() => {
                        setAsking(false);

                        if (nextPart) useItemDialogStore.getState().open(nextPart);
                        else close();
                    }}
                />
            )}
        </>
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
