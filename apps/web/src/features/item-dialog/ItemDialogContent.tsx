// The item dialog's content: its summary, then in its body the progress, hint, notices, meta area, the work record and
// the ticket's description and comments with the sidebar beside them, and its footer.

import { HINTS, itemName, needsAnswer, onAzure, sameRepo, writeAccessProblem } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Button, ButtonLink, buttonKind, Modal } from '@lar-works/design-system';

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
    const rows = fill
        ? 'min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]'
        : aside
          ? '@min-[45rem]:grid-rows-[auto_1fr]'
          : '';

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
                <div
                    className={`@container gap-3 pt-2 ${fill ? 'flex min-h-0 flex-1 flex-col' : 'grid grid-cols-[minmax(0,1fr)]'}`}
                    data-item-body
                >
                    <ItemProgress item={item} />
                    <ItemAgents item={item} />
                    {hint && (
                        <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5">
                            <ItemStatusGlyph item={item} presentation="title" />
                            <span className="min-w-0 flex-1 font-medium text-(--warning-foreground)">{hint}</span>
                        </div>
                    )}
                    {ticket && accessProblem && (
                        <div role="status">
                            <p>{accessProblem}</p>
                            <Button
                                {...buttonKind('other')}
                                onClick={() => void useEditStore.getState().recheck(item.repo)}
                            >
                                Recheck access
                            </Button>
                        </div>
                    )}
                    {item.paused && (
                        <p
                            data-paused
                            className="m-0 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5 font-medium text-(--warning-foreground)"
                        >
                            Paused: {item.paused}
                        </p>
                    )}
                    {item.shapingCleanupProblem && (
                        <p
                            data-shaping-cleanup-problem
                            className="m-0 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5 font-medium text-(--warning-foreground)"
                        >
                            {item.shapingCleanupProblem}
                        </p>
                    )}
                    <NeedsYou item={item} data={data} />
                    <ItemMeta item={item} read={read} refresh={refresh} now={now} />
                    <EarlierThreads item={item} data={data} />
                    {item.kind === 'concept' && <ConceptParts item={item} data={data} openPart={openPart} />}
                    <div
                        className={`grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 ${aside ? '@min-[45rem]:grid-cols-[minmax(0,1fr)_16rem]' : ''} ${rows}`}
                    >
                        {record && (
                            <RecordText
                                item={item}
                                record={record}
                                spec={read.state === 'loaded' && Boolean(read.details.spec)}
                                className="@min-[45rem]:col-start-1"
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
                                className="@min-[45rem]:col-start-1"
                            />
                        )}
                        {aside && <ItemAside item={item} data={data} now={now} read={read} />}
                        {ticket && (
                            <ItemComments
                                itemId={item.id}
                                read={read}
                                now={now}
                                ticketContext={Boolean(record)}
                                className="@min-[45rem]:col-start-1"
                            />
                        )}
                    </div>
                    <ActionError item={item} />
                    <StartMessage
                        item={item}
                        kind={item.status === 'Ready' || item.status === 'In progress' ? 'build' : 'refine'}
                    />
                    <StartAfterError item={item} data={data} />
                </div>
            </Modal.Body>
            <Modal.Footer
                leading={
                    <span className="inline-flex items-center gap-3 text-xs">
                        <MoveActions item={item} data={data} />
                    </span>
                }
            >
                <span className="inline-flex items-center gap-1.5">
                    {item.url && (
                        <ButtonLink {...buttonKind('other')} href={item.url} target="_blank" rel="noopener">
                            {item.repo && onAzure(item.repo) ? 'Azure DevOps' : 'GitHub'}
                        </ButtonLink>
                    )}
                    <StatusActions item={item} data={data} />
                </span>
            </Modal.Footer>
        </Modal.Content>
    );
}
