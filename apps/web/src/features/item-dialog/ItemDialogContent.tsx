// The item dialog's content: its progress first, then its summary, then the work record and ticket description with the sidebar,
// followed by access, metadata, earlier threads and comments. Actions stay in its footer.

import { groupProgress, itemName, sameRepo, writeAccessProblem } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Modal } from '@lar-works/design-system';

import { canStopShaping } from './can-stop-shaping';
import { CompleteReleaseStep } from './CompleteReleaseStep';
import { ConceptParts, ConceptWork } from './ConceptParts';
import { isGroupParent } from './group-parent';
import { ItemAside } from './ItemAside';
import { ItemComments } from './ItemComments';
import { ItemDescription } from './ItemDescription';
import { ItemMeta } from './ItemDetailsView';
import { MoveActions, StatusActions } from './ItemDialogActions';
import { ItemProgress } from './ItemProgress';
import { ItemSummary } from './ItemSummary';
import { RecordOutcome } from './RecordOutcome';
import { RecordText } from './RecordText';
import { hasRelations } from './Relations';
import { RetroFollowups } from './RetroFollowups';
import { StopShaping } from './StopShaping';
import { useConceptTotal } from './useConceptTotal';
import type { DescriptionEdit } from './useDescriptionEdit';
import { useMovesItem } from './useMovesItem';
import {
    ConceptBuild,
    ActionError,
    AgentWork,
    AgentWorkNote,
    EarlierThreads,
    NeedsYou,
    NeedsYouChoices,
    offersChoices,
    VerifyBuild,
    StartAfterError,
    StartMessage,
    useActivityUnavailable,
} from '@/features/items';
import { ItemAgents, isDone, partRef, partsOf } from '@/features/line';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { ExpandButton } from '@/shared/dialogs/ExpandDialog';
import {
    ReleaseProgress,
    DialogActions,
    ItemDialogBody,
    AsideFigures,
    ItemDialogColumns,
    ItemMainColumn,
    WarningNote,
} from '@/ui/board';

interface ContentProps {
    item: Item;
    data: BoardData;
    now: number;
    read: ItemDetailsRead;
    edit: DescriptionEdit;
    refresh: () => Promise<boolean>;
    expanded: boolean;
    toggleExpanded: () => void;
    openPart: (itemId: string) => void;
}

export function ItemDialogContent({
    item,
    data,
    now,
    read,
    edit,
    refresh,
    expanded,
    toggleExpanded,
    openPart,
}: ContentProps) {
    const group = isGroupParent(item, data.items);
    const progress = groupProgress(item, data.items, useActivityUnavailable());
    const builds = group
        ? partsOf(item, data.items).filter((part) => part.kind === 'build' && !part.item.setAside)
        : [];
    const buildsDone = builds.length > 0 && builds.every((part) => isDone(part.item));
    const aside = hasRelations(item, read, group);
    const record = read.state === 'loaded' ? read.details.record : undefined;
    // Work with no ticket has no ticket text to show beside its record's.
    const ticket = !record || item.number > 0;
    const setup = data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup;
    const accessProblem = writeAccessProblem(item.repo, 'edit-ticket', setup?.access ?? {}, {
        azureReadOnly: setup?.azureReadOnly,
        recheckAction: true,
    });
    const editable = !item.setAside && accessProblem === null;
    // The open editor in an expanded dialog takes the height the rest leaves.
    const fill = expanded && edit.editing;
    const moves = useMovesItem(item, data);
    // A concept's own figures say whose they are only beside its total with its parts.
    const total = useConceptTotal(item);

    // A group's record is its map, the long read, after its parts; while its briefs wait for the user's approval, the
    // review leads instead.
    const groupRecord = record && (record.body?.trim() || record.answer?.trim()) && (
        <RecordText
            item={item}
            record={record}
            refresh={refresh}
            spec={read.state === 'loaded' && Boolean(read.details.spec)}
        />
    );
    // The same briefs the record offers to approve: build work, not decisions, that hasn't passed and isn't sent back.
    const reviewFirst = data.items.some(
        (part) =>
            part.parentId === item.id &&
            part.passingBrief === false &&
            !part.briefChangesRequested &&
            !['concept', 'decision', 'slice'].includes(part.kind) &&
            part.status !== 'Done',
    );

    return (
        <Modal.Content
            title={partRef(item) ? `${partRef(item)} ${item.title}` : itemName(item)}
            presentation="workspace"
            // Sized to what it shows, loading or not, so a loading line never sits over a full-height empty sheet.
            fitsContent={!fill}
            data-item-dialog
            expanded={expanded}
            focusFirstField={false}
            headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />}
        >
            <Modal.Body layout={fill ? 'fill' : 'scroll'}>
                {/* Filling, a column whose description and comments take what the rest leave, however many of the rest show. */}
                <ItemDialogBody fill={fill} data-item-body>
                    <ItemDialogColumns aside fill={fill}>
                        <ItemMainColumn fill={fill}>
                            {/* Where the work stands leads every ticket, in the same place whatever else shows. */}
                            {!group && !item.setAside && <ItemProgress item={item} />}
                            {/* Then what waits on you, before the rest. */}
                            {!item.setAside && (
                                // Only why it waits on you: every action that answers it sits in the footer.
                                <NeedsYou item={item} data={data} />
                            )}
                            {!item.setAside && <RetroFollowups item={item} />}
                            {/* What its agents do now, before the ticket's own facts. */}
                            <ItemAgents item={item} />
                            {item.paused && <WarningNote data-paused>Paused: {item.paused}</WarningNote>}
                            {item.shapingCleanupProblem && (
                                <WarningNote data-shaping-cleanup-problem>{item.shapingCleanupProblem}</WarningNote>
                            )}
                            {!item.setAside && <VerifyBuild item={item} />}
                            {/* A group leads with where its work stands, its parts and then its builds; its map, the long
                                read, follows them. */}
                            {group && reviewFirst && groupRecord}
                            {group && <ConceptParts item={item} data={data} openPart={openPart} read={read} />}
                            {item.kind === 'concept' && item.status !== 'Done' && !buildsDone && (
                                <ConceptBuild item={item} />
                            )}
                            <ReleaseProgress
                                checkingOutcome={progress === 'Checking Outcome'}
                                outcomeControls={
                                    !item.setAside && (
                                        <RecordOutcome
                                            key={`outcome-${item.id}-${item.revision}`}
                                            item={item}
                                            items={data.items}
                                        />
                                    )
                                }
                                plan={item.releasePlan}
                                remaining={item.completion?.reasons}
                                name={(id) => data.items.find((part) => part.id === id)?.title ?? id}
                            />
                            {!item.setAside && <CompleteReleaseStep key={`${item.id}-${item.revision}`} item={item} />}
                            {group && !reviewFirst && groupRecord}
                            {record && !group && (
                                <RecordText
                                    item={item}
                                    record={record}
                                    refresh={refresh}
                                    spec={read.state === 'loaded' && Boolean(read.details.spec)}
                                />
                            )}
                            {ticket && (
                                <ItemDescription
                                    itemId={item.id}
                                    refresh={refresh}
                                    read={read}
                                    edit={edit}
                                    editable={editable}
                                    fill={fill}
                                    ticketContext={Boolean(record)}
                                />
                            )}
                            {ticket && (
                                <ItemComments itemId={item.id} read={read} now={now} ticketContext={Boolean(record)} />
                            )}
                            <ActionError item={item} />
                            <StartMessage
                                item={item}
                                kind={item.status === 'Ready' || item.status === 'In progress' ? 'build' : 'refine'}
                            />
                            <StartAfterError item={item} data={data} />
                        </ItemMainColumn>
                        <ItemAside
                            item={item}
                            data={data}
                            now={now}
                            read={read}
                            refresh={refresh}
                            relations={aside}
                            openPart={openPart}
                            lead={
                                <>
                                    <ItemSummary item={item} openPart={openPart} />
                                    <AsideFigures>
                                        {/* A concept's own figures, then its total with its parts, each named. */}
                                        <AgentWork rows item={item} label={total ? 'This concept' : undefined} />
                                        <ConceptWork item={item} />
                                        {(!group || item.usageState === 'loading' || item.usageState === 'failed') && (
                                            <AgentWorkNote item={item} />
                                        )}
                                    </AsideFigures>
                                    <ItemMeta item={item} read={read} refresh={refresh} now={now} />
                                    <EarlierThreads item={item} data={data} />
                                </>
                            }
                        />
                    </ItemDialogColumns>
                </ItemDialogBody>
            </Modal.Body>
            <Modal.Footer
                leading={
                    (moves || canStopShaping(item) || offersChoices(item, 'moves')) && (
                        <DialogActions presentation="leading">
                            {/* Abandon first, so it keeps one place whatever else shows. */}
                            <MoveActions item={item} data={data} />
                            <NeedsYouChoices item={item} data={data} side="moves" />
                            <StopShaping item={item} />
                        </DialogActions>
                    )
                }
            >
                {/* Every action the item's state asks for, with Open thread on its latest thread beside it. */}
                <DialogActions>
                    <StatusActions item={item} data={data} />
                </DialogActions>
            </Modal.Footer>
        </Modal.Content>
    );
}
