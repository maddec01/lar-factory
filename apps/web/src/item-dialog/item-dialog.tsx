// The item dialog: every item, wherever it's listed, opens here over the page, as the design system's workspace-sized
// Modal, whose body fades at its scrolled edges. Under its title it shows the item's repository, status and parent, with
// the agent work figures beside the title. Its body has a progress bar with the slices as an overview, its hint, a meta area of
// people, labels, dates, milestone or iteration and area, then its description and comments. Sub-tickets
// and pull requests sit in a sidebar beside them when the dialog is 45rem wide, else between the description and the
// comments. The board's fields show at
// once; the description, comments and people load when it opens. Its footer has GitHub, or Azure DevOps for a work
// item, and the one action the item's status asks for, with Back to List and Abandon at its left.

import { useEffect, type ReactNode } from 'react';
import { HINTS, carriesTwoStatuses, itemRepos, keepOneText, onAzure, openBlockers, ref, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import type { ItemDetailsRead } from './use-item-details.ts';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { useBoardStore } from '../board/board-store.ts';
import { AbandonButton, ActionError, BackToListButton, PickStatusButtons, QueueButton } from '../items/item-actions.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { PrLink } from '../items/pr-link.tsx';
import { AgentWork, PrList, RepoTag } from '../items/item-parts.tsx';
import { LinkButton } from '../items/link-button.tsx';
import { StartAfterError, StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage, useStartHolds } from '../items/start-control.tsx';
import { ItemStatusGlyph, StatusGlyph } from '../items/status-glyph.tsx';
import { ItemComments, ItemDescription, ItemMeta, ItemRelations } from './item-details-view.tsx';
import { useItemDialogStore } from './item-dialog-store.ts';
import { ItemProgress } from './item-progress.tsx';
import { useItemDetails } from './use-item-details.ts';

/** The one thing the item's status asks of you; an item carrying more than one status asks you to keep one. */
function StatusAction({ item, data }: { item: Item; data: BoardData }) {
  if (carriesTwoStatuses(item)) return <PickStatusButtons item={item} data={data} />;
  switch (item.status) {
    case 'List': return <QueueButton item={item} data={data} />;
    case 'Queued':
      if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;
      return <StartOrAfter item={item} data={data} label="Start refining" />;
    case 'Ready': return <StartBuild item={item} data={data} />;
    case 'Shaping': case 'In progress': case 'Review': return <OpenThread item={item} data={data} />;
    case 'Needs you': return <OpenThread item={item} data={data} label="Answer in T3" />;
    case 'Verify': return <PrLink item={item} label="Verify build" />;
    case 'Ready to merge': return <PrLink item={item} label="Merge PR" />;
    default: return null;
  }
}

/**
 * Back to List and Abandon; a Start in flight, uncertain or done, or a thread at work on the item, takes them away. An
 * item carrying more than one status keeps Abandon, which deletes it, but not Back to List, which moves it.
 */
function MoveActions({ item, data }: { item: Item; data: BoardData }) {
  const startHolds = useStartHolds(item, data);
  if (item.status === 'List') return <AbandonButton item={item} data={data} />;
  if (item.status !== 'Queued' || startHolds || hasLiveThread(item)) return null;
  return <>{!carriesTwoStatuses(item) && <BackToListButton item={item} data={data} />}<AbandonButton item={item} data={data} /></>;
}

/** Whether the sidebar has anything: pull requests, or sub-tickets (as many as the board counts while the details load). */
const hasRelations = (item: Item, read: ItemDetailsRead): boolean =>
  item.linkedPrs.length > 0
  || (read.state === 'loaded' ? (read.details.subTickets.length > 0 || Boolean(read.details.attachments?.length || read.details.related?.length || read.details.blockers?.length || read.details.relationsError)) : read.state === 'loading' && item.subIssues.total > 0);

const Section = ({ heading, children }: { heading: ReactNode; children: ReactNode }) => (
  <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"><h2 className="m-0 text-[13px] font-medium">{heading}</h2>{children}</section>
);

function ItemDialogContent({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const read = useItemDetails(item.id, item.updatedAt);
  const aside = hasRelations(item, read);
  const hint = carriesTwoStatuses(item) ? keepOneText(item.statuses) : HINTS[item.status];
  return (
    <Modal.Content title={`${ref(item)} ${item.title}`} presentation="workspace" data-item-dialog
      headerActions={<AgentWork item={item} className="whitespace-nowrap text-xs text-base-700 @max-[40rem]:hidden" />}>
      <div className="@container grid shrink-0 gap-1 border-b border-base-300 px-5 pb-3 text-xs text-base-700 sm:px-6" data-item-summary>
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          {itemRepos(item).map((repo) => <RepoTag key={repo} repo={repo} repos={data.repos} />)}
          <ItemStatusGlyph item={item} /> <span className="font-medium text-base-content">{item.status}</span>
          <span className="min-w-0 truncate @max-[30rem]:hidden">· updated {shortAgo(item.updatedAt, now)}</span>
          {openBlockers(item).length > 0 && <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)">blocked by {openBlockers(item).length}</span>}
        </div>
        {item.parent && <p className="m-0 min-w-0 wrap-anywhere" data-item-parent>Part of <a href={item.parent.url} target="_blank" rel="noopener" className="underline">#{item.parent.number} {item.parent.title}</a></p>}
      </div>
      <Modal.Body>
        <div className="@container grid grid-cols-[minmax(0,1fr)] gap-3 pt-2" data-item-body>
          <ItemProgress item={item} />
          {hint && (
            <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5">
              <StatusGlyph status={item.status} className="size-4" />
              <span className="min-w-0 flex-1 font-medium text-(--warning-foreground)">{hint}</span>
            </div>
          )}
          <ItemMeta item={item} read={read} now={now} />
          <div className={`grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 ${aside ? '@min-[45rem]:grid-cols-[minmax(0,1fr)_16rem] @min-[45rem]:grid-rows-[auto_1fr]' : ''}`}>
            <ItemDescription read={read} className="@min-[45rem]:col-start-1" />
            {aside && (
              <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 @min-[45rem]:col-start-2 @min-[45rem]:row-span-2 @min-[45rem]:row-start-1 @min-[45rem]:border-l @min-[45rem]:border-(--border) @min-[45rem]:pl-6">
                <ItemRelations item={item} read={read} />
                {item.linkedPrs.length > 0 && <Section heading="Pull requests"><PrList item={item} /></Section>}
              </aside>
            )}
            <ItemComments itemId={item.id} read={read} now={now} className="@min-[45rem]:col-start-1" />
          </div>
          <ActionError item={item} />
          <StartMessage item={item} kind={item.status === 'Ready' ? 'build' : 'refine'} />
          <StartAfterError item={item} data={data} />
        </div>
      </Modal.Body>
      <Modal.Footer leading={<span className="inline-flex items-center gap-3 text-xs"><MoveActions item={item} data={data} /></span>}>
        <span className="inline-flex items-center gap-1.5">
          {item.url && <LinkButton kind="other" href={item.url} target="_blank" rel="noopener">{item.repo && onAzure(item.repo) ? 'Azure DevOps' : 'GitHub'}</LinkButton>}
          <StatusAction item={item} data={data} />
        </span>
      </Modal.Footer>
    </Modal.Content>
  );
}

export function ItemDialog() {
  const { data, now } = useBoardStore();
  const { itemId, close } = useItemDialogStore();
  const item = data.items.find((i) => i.id === itemId);
  // An item that left the board closes the dialog for good, so a later read that brings it back doesn't reopen it.
  useEffect(() => {
    if (itemId && !item) close();
  }, [itemId, item, close]);
  if (!item) return null;
  return <Modal onClose={close}><ItemDialogContent item={item} data={data} now={now} /></Modal>;
}
