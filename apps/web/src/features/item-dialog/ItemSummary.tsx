// The item dialog's summary under its title: the item's source, repository and what it is doing now, as the one
// item-state presenter says it on every surface (the stage bar below names the recorded stage), what blocks it, its parent, its
// kind as its row names it when the dialog's Kind control doesn't, and attaching or creating its ticket. Each property
// stays on one line: a blocked item says what holds it in short, as its row does ("Blocked by Part 15"), the tooltip in full,
// and a plan kept on this Mac says so on a quiet line under the properties (and on the source mark's tooltip). The meta
// area says when it was updated.

import {
    blockedText,
    staleGateReason,
    itemName,
    openBlockers,
    retiredPartLabel,
    trackerCapabilities,
} from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { AttachTicket } from './AttachTicket';
import { CreateTicket } from './CreateTicket';
import { isGroupParent } from './group-parent';
import { ItemKindControl } from './ItemKindControl';
import {
    ICON,
    ItemKind,
    ItemStatusGlyph,
    partWait,
    RepoCell,
    SourceIcon,
    StructureSync,
    useShownStatus,
} from '@/features/items';
import { RowKind } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import { ItemSummary as Summary, SummaryBlocked, SummaryParent, SummaryStatus, TrackerLink } from '@/ui/board';

/** `openPart` opens another item in the dialog, such as the concept the item is part of. */
export function ItemSummary({ item, openPart }: { item: Item; openPart?: ((itemId: string) => void) | undefined }) {
    const data = useBoardStore((state) => state.data);
    const items = data.items;
    const group = isGroupParent(item, items);
    const parentOnBoard = item.parentId ? items.find((other) => other.id === item.parentId) : undefined;
    const shown = useShownStatus(item);
    const held = !item.setAside && (shown.blocked || openBlockers(item).length > 0);
    // A plan waiting to reach its tracker is said on the source mark; one that failed to save takes a line of its own.
    const unsaved = !!item.sync && item.sync.state !== 'saved';
    const syncFailed = item.sync?.state === 'error' || item.sync?.state === 'conflict';
    // Keep the presenter's live delivery progress: a group's stored stage may still be Shaping.
    const word = shown.word === 'List' ? 'On the List' : shown.word;
    const tracker = trackerCapabilities(item.repo);

    return (
        <Summary
            data-item-summary
            status={
                <>
                    <ItemStatusGlyph item={item} />
                    {/* Blocked by other work isn't your turn, so it keeps the item's own glyph, not the amber light. */}
                    <SummaryStatus
                        title={
                            item.closeReason
                                ? `Closed ${item.closeReason}`
                                : held
                                  ? (blockedText(item) ?? shown.word)
                                  : item.setAside
                                    ? `Last status: ${shown.recorded}`
                                    : shown.recorded
                        }
                    >
                        {/* What holds it in short, as its row says it ("Blocked by Part 15"), the tooltip in full. */}
                        {item.closeReason
                            ? `Closed ${item.closeReason}`
                            : held
                              ? (partWait(item, data) ?? 'Blocked')
                              : (retiredPartLabel(item) ?? word)}
                    </SummaryStatus>
                    {!item.setAside && item.staleGate && (
                        <SummaryBlocked title={staleGateReason(item) ?? undefined}>Approval out of date</SummaryBlocked>
                    )}
                </>
            }
            project={
                <>
                    {/* One tracker mark after the project, ticketed or not: the ticket's link when it has one, else
                        where it is saved. A plan not yet on its ticket says so on the link's tooltip. */}
                    <RepoCell item={item} />
                    {!item.url && <SourceIcon item={item} bare always />}
                    {item.url && (
                        <TrackerLink
                            href={item.url}
                            icon={ICON[tracker.icon]}
                            name={tracker.name}
                            note={unsaved ? 'Planning is saved on this Mac.' : undefined}
                        />
                    )}
                </>
            }
            parent={
                item.parent && (
                    <SummaryParent
                        data-item-parent
                        prefix="Part of"
                        name={itemName(item.parent)}
                        onOpen={parentOnBoard && openPart ? () => openPart(parentOnBoard.id) : undefined}
                        href={item.parent.url}
                    />
                )
            }
            kind={
                <>
                    <ItemKind
                        item={item}
                        summaryKind={<ItemKindControl item={item} fallback={<RowKind item={item} />} />}
                    />
                    <StructureSync item={item} localNote={false} />
                </>
            }
            // A plan kept on this Mac says so on a quiet line of its own, as it did beside the kind; a failed save says why.
            note={!group && unsaved && (syncFailed ? <StructureSync item={item} /> : 'Planning is saved on this Mac.')}
            actions={
                !item.setAside &&
                item.status !== 'Done' && (
                    <>
                        <AttachTicket item={item} />
                        <CreateTicket item={item} />
                    </>
                )
            }
        />
    );
}
