// The item dialog's content: its summary, then in its body the progress, hint, notices, meta area, the work record and
// the ticket's description and comments with the sidebar beside them, and its footer.

import { HINTS, itemName, needsAnswer, onAzure, sameRepo, writeAccessProblem } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import {
    AccessNotice,
    Button,
    ButtonLink,
    buttonKind,
    DialogActions,
    ItemDialogBody,
    ItemDialogColumns,
    Modal,
    WarningNote,
} from '@lar-works/design-system';

import { ConceptParts } from './ConceptParts';
import { ItemAside } from './ItemAside';
import { ItemComments } from './ItemComments';
import { ItemDescription } from './ItemDescription';
import { ItemMeta } from './ItemDetailsView';
import { MoveActions, StatusActions } from './ItemDialogActions';
import { ItemProgress } from './ItemProgress';
import { ItemSummary } from './ItemSummary';
import { RecordText } from './RecordText';
import { hasRelations } from './Relations';
import type { DescriptionEdit } from './useDescriptionEdit';
import type { ItemDetailsRead } from './useItemDetails';
import {
    ActionError,
    AgentWork,
    EarlierThreads,
    ItemStatusGlyph,
    NeedsYou,
    StartAfterError,
    StartMessage,
    useShownStatus,
} from '@/features/items';
import { ItemAgents } from '@/features/line';
import { useEditStore } from '@/features/repositories';
import { ExpandButton } from '@/shared/dialogs/ExpandDialog';

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
    const aside = hasRelations(item, read);
    const record = read.state === 'loaded' ? read.details.record : undefined;
    // Work with no ticket has no ticket text to show beside its record's.
    const ticket = !record || item.number > 0;
    const shown = useShownStatus(item);
    const hint = needsAnswer(item) ? 'Answer in T3' : shown.working ? undefined : HINTS[item.status];
    const setup = data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup;
    const accessProblem = writeAccessProblem(item.repo, 'edit-ticket', setup?.access ?? {}, {
        azureReadOnly: setup?.azureReadOnly,
    });
    const editable = accessProblem === null;
    // The open editor in an expanded dialog takes the height the rest leaves.
    const fill = expanded && edit.editing;

    return (
        <Modal.Content
            title={`${itemName(item)}`}
            presentation="workspace"
            data-item-dialog
            expanded={expanded}
            focusFirstField={false}
            headerActions={
                <>
                    {item.kind !== 'concept' && <AgentWork item={item} only="wide" />}
                    <ExpandButton expanded={expanded} toggle={toggleExpanded} />
                </>
            }
        >
            <ItemSummary item={item} data={data} now={now} />
            <Modal.Body layout={fill ? 'fill' : 'scroll'}>
                {/* Filling, a column whose description and comments take what the rest leave, however many of the rest show. */}
                <ItemDialogBody fill={fill} data-item-body>
                    <ItemProgress item={item} />
                    <ItemAgents item={item} />
                    {hint && (
                        <WarningNote icon={<ItemStatusGlyph item={item} presentation="title" />}>{hint}</WarningNote>
                    )}
                    {ticket && accessProblem && (
                        <AccessNotice
                            message={accessProblem}
                            action={
                                <Button
                                    {...buttonKind('other')}
                                    onClick={() => void useEditStore.getState().recheck(item.repo)}
                                >
                                    Recheck access
                                </Button>
                            }
                        />
                    )}
                    {item.paused && <WarningNote data-paused>Paused: {item.paused}</WarningNote>}
                    {item.shapingCleanupProblem && (
                        <WarningNote data-shaping-cleanup-problem>{item.shapingCleanupProblem}</WarningNote>
                    )}
                    <NeedsYou item={item} data={data} />
                    <ItemMeta item={item} read={read} refresh={refresh} now={now} />
                    <EarlierThreads item={item} data={data} />
                    {item.kind === 'concept' && <ConceptParts item={item} data={data} openPart={openPart} />}
                    <ItemDialogColumns aside={aside} fill={fill}>
                        {record && (
                            <RecordText
                                item={item}
                                record={record}
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
                        {aside && <ItemAside item={item} data={data} now={now} read={read} />}
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
                    <DialogActions presentation="leading">
                        <MoveActions item={item} data={data} />
                    </DialogActions>
                }
            >
                <DialogActions>
                    {item.url && (
                        <ButtonLink {...buttonKind('other')} href={item.url} target="_blank" rel="noopener">
                            {item.repo && onAzure(item.repo) ? 'Azure DevOps' : 'GitHub'}
                        </ButtonLink>
                    )}
                    <StatusActions item={item} data={data} />
                </DialogActions>
            </Modal.Footer>
        </Modal.Content>
    );
}
