import { useEditStore } from '../repositories/edit-store.ts';
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

import { useEffect, useState, type ReactNode } from 'react';
import { currentBuildThread, needsAnswer, openQuestionThread, writeAccessProblem, HINTS, blockedText, canResumeShaping, canRetryBuild, onAzure, openBlockers, itemName, repoKey, sameRepo, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import type { ItemDetailsRead } from './use-item-details.ts';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { useBoardStore } from '../board/board-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { EXPANDED, ExpandButton, useExpand } from '../expand-dialog/expand-dialog.tsx';
import { AbandonButton, ActionError, BackToListButton, QueueButton } from '../items/item-actions.tsx';
import { EarlierThreads, OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { NeedsYou } from '../items/needs-you.tsx';
import { Dependencies, dependenciesOf } from '../items/dependencies.tsx';
import { PrLink } from '../items/pr-link.tsx';
import { AgentWork, ItemKind, PrList, RepoTag, StructureSync, useShownStatus } from '../items/item-parts.tsx';
import { LinkButton } from '../items/link-button.tsx';
import { StartAfterError, StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage, useStartHolds } from '../items/start-control.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { ConceptParts } from './concept-parts.tsx';
import { ItemComments, ItemDescription, ItemMeta, ItemRelations } from './item-details-view.tsx';
import { useItemDialogStore } from './item-dialog-store.ts';
import { useDescriptionEdit } from './use-description-edit.ts';
import type { DescriptionEdit } from './use-description-edit.ts';
import { ItemProgress } from './item-progress.tsx';
import { useItemDetails } from './use-item-details.ts';
import { CreateTicket } from './create-ticket.tsx';
import { AttachTicket } from './attach-ticket.tsx';
import { RecordText } from './record-text.tsx';

/** A status's action: a thread it opens, the latest when `opens` names none, or another control. */
type StatusAction = { opens: string | undefined; label?: string } | { control: ReactNode };

const LATEST_THREAD: StatusAction = { opens: undefined };

const latestThread = (item: Item) => (Array.isArray(item.threads) ? item.threads[0]?.id : undefined);

/** The one thing the item's status asks of you. A Start leaves the latest thread to the Open thread beside it. */
function statusAction(item: Item, data: BoardData, working: boolean): StatusAction {
  const linkedBeside = latestThread(item);
  if (working) return { opens: currentBuildThread(item)?.id };
  if (needsAnswer(item)) return { opens: openQuestionThread(item)?.id, label: 'Answer in T3' };
  switch (item.status) {
    case 'List': return { control: <QueueButton item={item} data={data} /> };
    case 'Queued':
      if (hasLiveThread(item)) return LATEST_THREAD;
      return { control: <StartOrAfter item={item} data={data} label="Shape issue" linkedBeside={linkedBeside} /> };
    case 'Ready': return hasLiveThread(item) ? LATEST_THREAD : { control: <StartBuild item={item} data={data} linkedBeside={linkedBeside} /> };
    case 'Shaping': return canResumeShaping(item) ? { control: <StartOrAfter item={item} data={data} label="Resume shaping" linkedBeside={linkedBeside} /> } : LATEST_THREAD;
    case 'In progress': return canRetryBuild(item) ? { control: <StartBuild item={item} data={data} linkedBeside={linkedBeside} /> } : LATEST_THREAD;
    case 'Review': return LATEST_THREAD;
    case 'Verify': return { control: <PrLink item={item} label="Verify build" /> };
    case 'Ready to merge': return { control: <PrLink item={item} label="Merge PR" /> };
    default: return { control: null };
  }
}

/** The status's action, with Open thread on the latest thread beside it unless the action already opens that thread. */
function StatusActions({ item, data }: { item: Item; data: BoardData }) {
  const { working } = useShownStatus(item);
  const action = statusAction(item, data, working);
  const latest = latestThread(item);
  const opensThread = 'opens' in action;
  const beside = item.threads === 'unavailable' ? !opensThread : latest !== undefined && !(opensThread && (action.opens ?? latest) === latest);
  return <>
    {beside && <OpenThread item={item} data={data} />}
    {opensThread ? <OpenThread item={item} data={data} threadId={action.opens} label={action.label} /> : action.control}
  </>;
}

/** Move to List and Abandon; a Start in flight, uncertain or done, or a thread at work on the item, takes them away. */
function MoveActions({ item, data }: { item: Item; data: BoardData }) {
  const startHolds = useStartHolds(item, data);
  if (item.status === 'List') return <AbandonButton item={item} data={data} />;
  if (item.status !== 'Queued' || startHolds || hasLiveThread(item)) return null;
  return <><BackToListButton item={item} data={data} /><AbandonButton item={item} data={data} /></>;
}

/** The work records the item's record waits on, as the board holds them. */
const waitsOn = (item: Item) => item.blockers.filter((b) => b.workId);

/** Whether the sidebar has anything: work it waits on, Dependencies, pull requests, or sub-tickets (as many as the board counts while the details load). */
const hasRelations = (item: Item, read: ItemDetailsRead): boolean =>
  item.linkedPrs.length > 0 || waitsOn(item).length > 0 || dependenciesOf(item).length > 0
  || (read.state === 'loaded' ? (read.details.subTickets.length > 0 || Boolean(read.details.attachments?.length || read.details.related?.length || read.details.blockers?.length || read.details.relationsError)) : read.state === 'loading' && item.subIssues.total > 0);

const Section = ({ heading, children }: { heading: ReactNode; children: ReactNode }) => (
  <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"><h2 className="m-0 text-[13px] font-medium">{heading}</h2>{children}</section>
);

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

function ItemDialogContent({ item, data, now, read, edit, refresh, expanded, toggleExpanded, openPart }: ContentProps) {
  const aside = hasRelations(item, read);
  const record = read.state === 'loaded' ? read.details.record : undefined;
  // Work with no ticket has no ticket text to show beside its record's.
  const ticket = !record || item.number > 0;
  const shown = useShownStatus(item);
  const hint = needsAnswer(item) ? 'Answer in T3' : shown.working ? undefined : HINTS[item.status];
  const setup = data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup;
  const accessProblem = writeAccessProblem(item.repo, 'edit-ticket', setup?.access ?? {}, { azureReadOnly: setup?.azureReadOnly });
  const editable = accessProblem === null;
  // The open editor in an expanded dialog takes the height the rest leaves.
  const fill = expanded && edit.editing;
  const rows = fill ? 'min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]' : aside ? '@min-[45rem]:grid-rows-[auto_1fr]' : '';
  return (
    <Modal.Content title={`${itemName(item)}`} presentation="workspace" data-item-dialog style={expanded ? EXPANDED : undefined} focusFirstField={false}
      headerActions={<>
        {item.kind !== 'concept' && <AgentWork item={item} className="whitespace-nowrap text-xs text-base-700 @max-[40rem]:hidden" />}
        <ExpandButton expanded={expanded} toggle={toggleExpanded} />
      </>}>
      <div className="@container grid shrink-0 gap-1 border-b border-base-300 px-5 pb-3 text-xs text-base-700 sm:px-6" data-item-summary>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SourceIcon item={item} />
          <RepoTag repo={repoKey(item)} repos={data.repos} />
          <StatusGlyph status={shown.glyph} /> <span className="font-medium text-base-content">{shown.word}</span>
          <span className="min-w-0 truncate @max-[30rem]:hidden">· updated {shortAgo(item.updatedAt, now)}</span>
          {openBlockers(item).length > 0 && <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)" title={blockedText(item) ?? undefined}>blocked by {openBlockers(item).length}<span className="sr-only">. {blockedText(item)}</span></span>}
        </div>
        {item.parent && <p className="m-0 min-w-0 wrap-anywhere" data-item-parent>Part of {item.parent.url
          ? <a href={item.parent.url} target="_blank" rel="noopener" className="underline">{itemName(item.parent)}</a> : itemName(item.parent)}</p>}
        <div className="flex flex-wrap items-center gap-2"><ItemKind item={item} /><StructureSync item={item} /></div>
        <div className="flex flex-wrap items-start gap-2"><AttachTicket item={item} /><CreateTicket item={item} /></div>
      </div>
      <Modal.Body layout={fill ? 'fill' : 'scroll'}>
        {/* Filling, a column whose description and comments take what the rest leave, however many of the rest show. */}
        <div className={`@container gap-3 pt-2 ${fill ? 'flex min-h-0 flex-1 flex-col' : 'grid grid-cols-[minmax(0,1fr)]'}`} data-item-body>
          <ItemProgress item={item} />
          {hint && (
            <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5">
              <StatusGlyph status={item.status} className="size-4" />
              <span className="min-w-0 flex-1 font-medium text-(--warning-foreground)">{hint}</span>
            </div>
          )}
          {ticket && accessProblem && <div role="status"><p>{accessProblem}</p><Button {...kind('other')} onClick={() => void useEditStore.getState().recheck(item.repo)}>Recheck access</Button></div>}
          {item.paused && <p data-paused className="m-0 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5 font-medium text-(--warning-foreground)">Paused: {item.paused}</p>}
          {item.shapingCleanupProblem && <p data-shaping-cleanup-problem className="m-0 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5 font-medium text-(--warning-foreground)">{item.shapingCleanupProblem}</p>}
          <NeedsYou item={item} data={data} />
          <ItemMeta item={item} read={read} refresh={refresh} now={now} />
          <EarlierThreads item={item} data={data} />
          {item.kind === 'concept' && <ConceptParts item={item} data={data} openPart={openPart} />}
          <div className={`grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 ${aside ? '@min-[45rem]:grid-cols-[minmax(0,1fr)_16rem]' : ''} ${rows}`}>
            {record && <RecordText item={item} record={record} spec={read.state === 'loaded' && Boolean(read.details.spec)} className="@min-[45rem]:col-start-1" />}
            {ticket && <ItemDescription itemId={item.id} refresh={refresh} read={read} edit={edit} editable={editable} fill={fill} ticketContext={Boolean(record)} className="@min-[45rem]:col-start-1" />}
            {aside && (
              <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 @min-[45rem]:col-start-2 @min-[45rem]:row-span-2 @min-[45rem]:row-start-1 @min-[45rem]:border-l @min-[45rem]:border-(--border) @min-[45rem]:pl-6">
                {waitsOn(item).length > 0 && <Section heading="Waits on"><ul className="m-0 grid list-none gap-1.5 p-0 text-sm" data-waits-on>
                  {waitsOn(item).map((b) => <li key={b.workId} className={b.state === 'closed' ? 'text-(--muted-foreground) line-through' : ''}>{b.title}</li>)}
                </ul></Section>}
                {dependenciesOf(item).length > 0 && <Section heading="Dependencies"><Dependencies item={item} data={data} now={now} /></Section>}
                <ItemRelations item={item} read={read} />
                {item.linkedPrs.length > 0 && <Section heading="Pull requests"><PrList item={item} /></Section>}
              </aside>
            )}
            {ticket && <ItemComments itemId={item.id} read={read} now={now} ticketContext={Boolean(record)} className="@min-[45rem]:col-start-1" />}
          </div>
          <ActionError item={item} />
          <StartMessage item={item} kind={item.status === 'Ready' || item.status === 'In progress' ? 'build' : 'refine'} />
          <StartAfterError item={item} data={data} />
        </div>
      </Modal.Body>
      <Modal.Footer leading={<span className="inline-flex items-center gap-3 text-xs"><MoveActions item={item} data={data} /></span>}>
        <span className="inline-flex items-center gap-1.5">
          {item.url && <LinkButton kind="other" href={item.url} target="_blank" rel="noopener">{item.repo && onAzure(item.repo) ? 'Azure DevOps' : 'GitHub'}</LinkButton>}
          <StatusActions item={item} data={data} />
        </span>
      </Modal.Footer>
    </Modal.Content>
  );
}

/** Asks before closing the dialog drops unsaved edits to the description. */
function DiscardPrompt({ keep, discard }: { keep: () => void; discard: () => void }) {
  return (
    <Modal onClose={keep}>
      <Modal.Content title="Discard changes?" description="Your edits to the description haven't been saved.">
        <Modal.Footer>
          <Button {...kind('other')} onClick={keep}>Keep editing</Button>
          <Button {...kind('main', 'danger')} onClick={discard}>Discard</Button>
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
    useItemDialogStore.setState({ dismiss: () => {
      if (!edit.saving) {
        if (edit.dirty) setAsking(true);
        else close();
      }
    } });
    return () => { useItemDialogStore.setState({ dismiss: null }); };
  }, [edit.saving, edit.dirty, close]);
  const openPart = (itemId: string) => {
    if (edit.saving) return;
    if (!edit.dirty) useItemDialogStore.getState().open(itemId);
    else { setNextPart(itemId); setAsking(true); }
  };
  return <>
    <Modal onClose={() => (edit.dirty ? setAsking(true) : close())} loading={edit.saving}>
      <ItemDialogContent item={item} data={data} now={now} read={read} edit={edit} refresh={refresh} expanded={expanded} toggleExpanded={toggleExpanded} openPart={openPart} />
    </Modal>
    {asking && <DiscardPrompt keep={() => { setAsking(false); setNextPart(null); }} discard={() => {
      setAsking(false);
      if (nextPart) useItemDialogStore.getState().open(nextPart);
      else close();
    }} />}
  </>;
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
