// The item dialog's content: its summary and progress, then the work record and ticket description with the sidebar,
// followed by access, metadata, earlier threads and comments. Actions stay in its footer.

import { itemName, onAzure, sameRepo, writeAccessProblem } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { ButtonLink, Modal, Stack } from '@lar-works/design-system';

import { ConceptParts } from './ConceptParts';
import { isGroupParent } from './group-parent';
import { GroupDetails } from './GroupDetails';
import { ItemAside } from './ItemAside';
import { ItemComments } from './ItemComments';
import { ItemDescription } from './ItemDescription';
import { ItemMeta } from './ItemDetailsView';
import { MoveActions, StatusActions } from './ItemDialogActions';
import { ItemProgress } from './ItemProgress';
import { ItemSummary } from './ItemSummary';
import { RecordText } from './RecordText';
import { hasRelations } from './Relations';
import { RetroFollowups } from './RetroFollowups';
import type { DescriptionEdit } from './useDescriptionEdit';
import { useMovesItem } from './useMovesItem';
import {
    ConceptBuild,
    ActionError,
    AgentWork,
    AgentWorkNote,
    EarlierThreads,
    ICON,
    NeedsYou,
    VerifyBuild,
    StartAfterError,
    StartMessage,
} from '@/features/items';
import { ItemAgents, isDone, partsOf } from '@/features/line';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { ExpandButton } from '@/shared/dialogs/ExpandDialog';
import {
    ReleaseProgress,
    buttonKind,
    DialogActions,
    ItemDialogBody,
    ItemDialogColumns,
    MainColumnSlot,
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
    const builds = group ? partsOf(item, data.items).filter((part) => part.kind === 'build') : [];
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
    const editable = accessProblem === null;
    // The open editor in an expanded dialog takes the height the rest leaves.
    const fill = expanded && edit.editing;
    const moves = useMovesItem(item, data);

    return (
        <Modal.Content
            title={`${itemName(item)}`}
            presentation="workspace"
            fitsContent={read.state !== 'loading' && !edit.editing}
            data-item-dialog
            expanded={expanded}
            focusFirstField={false}
            headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />}
            headerDetails={
                <>
                    {group && <GroupDetails item={item} />}
                    <AgentWork item={item} label={item.kind === 'concept' ? 'Direct work' : undefined} />
                    {(!group || item.usageState === 'loading' || item.usageState === 'failed') && (
                        <AgentWorkNote item={item} />
                    )}
                </>
            }
        >
            <ItemSummary item={item} />
            <Modal.Body layout={fill ? 'fill' : 'scroll'}>
                {/* Filling, a column whose description and comments take what the rest leave, however many of the rest show. */}
                <ItemDialogBody fill={fill} data-item-body>
                    {!group && <ItemProgress item={item} />}
                    {item.paused && <WarningNote data-paused>Paused: {item.paused}</WarningNote>}
                    {item.shapingCleanupProblem && (
                        <WarningNote data-shaping-cleanup-problem>{item.shapingCleanupProblem}</WarningNote>
                    )}
                    <NeedsYou item={item} data={data} />
                    <VerifyBuild item={item} />
                    <RetroFollowups item={item} />
                    {item.kind === 'concept' && item.status !== 'Done' && !buildsDone && <ConceptBuild item={item} />}
                    {group && <ConceptParts item={item} data={data} openPart={openPart} />}
                    <ReleaseProgress plan={item.releasePlan} remaining={item.completion?.reasons} />
                    <ItemDialogColumns aside={aside} fill={fill}>
                        {record && (!group || record.body?.trim() || record.answer?.trim()) && (
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
                        {aside && <ItemAside item={item} data={data} now={now} read={read} refresh={refresh} />}
                        <MainColumnSlot>
                            <Stack>
                                <ItemMeta item={item} read={read} refresh={refresh} now={now} />
                                <ItemAgents item={item} />
                                <EarlierThreads item={item} data={data} />
                            </Stack>
                        </MainColumnSlot>
                        {ticket && (
                            <ItemComments itemId={item.id} read={read} now={now} ticketContext={Boolean(record)} />
                        )}
                    </ItemDialogColumns>
                    <ActionError item={item} />
                    <StartMessage
                        item={item}
                        kind={item.status === 'Ready' || item.status === 'In progress' ? 'build' : 'refine'}
                    />
                    <StartAfterError item={item} data={data} />
                </ItemDialogBody>
            </Modal.Body>
            <Modal.Footer
                leading={
                    moves && (
                        <DialogActions presentation="leading">
                            <MoveActions item={item} data={data} />
                        </DialogActions>
                    )
                }
            >
                <DialogActions>
                    {item.url && (
                        <ButtonLink
                            look="app"
                            {...buttonKind('other', { size: 'md' })}
                            icon={item.repo && onAzure(item.repo) ? ICON.azure : ICON.github}
                            href={item.url}
                            target="_blank"
                            rel="noopener"
                        >
                            {item.repo && onAzure(item.repo) ? 'Azure DevOps' : 'GitHub'}
                        </ButtonLink>
                    )}
                    <StatusActions item={item} data={data} />
                </DialogActions>
            </Modal.Footer>
        </Modal.Content>
    );
}
