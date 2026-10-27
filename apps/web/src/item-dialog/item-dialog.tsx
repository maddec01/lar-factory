// The item dialog: every item, wherever it's listed, opens here over the page. It shows the item's repository,
// status, track, hint, slices, pull requests, agent work and labels. Its footer has GitHub, or Azure DevOps for a work
// item, and the one action the item's status asks for, with Back to List and Abandon at its left.

import { useEffect, useRef } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import { HINTS, carriesTwoStatuses, itemRepos, keepOneText, onAzure, openBlockers, shortAgo, workMessage } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@lar-factory/ui/dialog';
import { useBoardStore } from '../board/board-store.ts';
import { AbandonButton, ActionError, BackToListButton, PickStatusButtons, QueueButton } from '../items/item-actions.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { PrLink } from '../items/pr-link.tsx';
import { ItemTitle, PrList, RepoTag, SliceList, StatsGrid, StepTrack } from '../items/item-parts.tsx';
import { StartAfterError, StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage, useStartHolds } from '../items/start-control.tsx';
import { ItemStatusGlyph, StatusGlyph } from '../items/status-glyph.tsx';
import { useItemDialogStore } from './item-dialog-store.ts';

/** The one thing the item's status asks of you; an item carrying more than one status asks you to keep one. */
function StatusAction({ item, data }: { item: Item; data: BoardData }) {
  if (carriesTwoStatuses(item)) return <PickStatusButtons item={item} data={data} />;
  switch (item.status) {
    case 'List': return <QueueButton item={item} data={data} />;
    case 'Queued':
      if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;
      if (!workMessage(item)) return null;
      return <StartOrAfter item={item} data={data} label="Start refining" size="sm" icon={<Play />} />;
    case 'Ready': return <StartBuild item={item} data={data} size="sm" icon={<Play />} />;
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
  if (item.status !== 'Queued' || item.content === 'pr' || startHolds || hasLiveThread(item)) return null;
  return <>{!carriesTwoStatuses(item) && <BackToListButton item={item} data={data} />}<AbandonButton item={item} data={data} /></>;
}

function ItemDialogBody({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const hint = carriesTwoStatuses(item) ? keepOneText(item.statuses) : HINTS[item.status];
  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2 pr-8 text-xs text-(--muted-foreground)">
          {itemRepos(item).map((repo) => <RepoTag key={repo} repo={repo} repos={data.repos} />)}
          <ItemStatusGlyph item={item} /> <span className="font-medium text-(--foreground)">{item.status}</span> · updated {shortAgo(item.updatedAt, now)}
          {openBlockers(item).length > 0 && <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)">blocked by {openBlockers(item).length}</span>}
        </div>
        <DialogTitle className="text-lg leading-snug tracking-tight"><ItemTitle item={item} /></DialogTitle>
        {item.parent && <DialogDescription>Part of <a href={item.parent.url} target="_blank" rel="noopener" className="underline">#{item.parent.number} {item.parent.title}</a></DialogDescription>}
      </DialogHeader>
      <DialogPanel className="grid gap-5 space-y-0">
        <StepTrack status={item.status} labels />
        {hint && (
          <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5">
            <StatusGlyph status={item.status} className="size-4" />
            <span className="flex-1 font-medium text-(--warning-foreground)">{hint}</span>
          </div>
        )}
        {item.slices.length > 0 && (
          <section className="grid gap-2">
            <h2 className="m-0 text-[13px] font-medium">Slices <span className="text-(--muted-foreground)">{item.slices.filter((s) => s.progress === 'done').length}/{item.slices.length} done</span></h2>
            <SliceList item={item} />
          </section>
        )}
        {item.linkedPrs.length > 0 && <section className="grid gap-2"><h2 className="m-0 text-[13px] font-medium">Pull requests</h2><PrList item={item} /></section>}
        <section className="grid gap-2"><h2 className="m-0 text-[13px] font-medium">Agent work</h2><StatsGrid item={item} /></section>
        {item.labels.length > 0 && <p className="m-0 flex flex-wrap gap-1">{item.labels.map((l) => <span key={l} className="rounded-(--radius-sm) border border-(--input) px-1.5 text-[11px] text-(--muted-foreground)">{l}</span>)}</p>}
        <ActionError item={item} />
        <StartMessage item={item} kind={item.status === 'Ready' ? 'build' : 'refine'} />
        <StartAfterError item={item} data={data} />
      </DialogPanel>
      <DialogFooter>
        <span className="mr-auto inline-flex items-center gap-3 text-xs"><MoveActions item={item} data={data} /></span>
        <span className="inline-flex items-center gap-1.5">
          {item.url && <Button variant="outline" size="sm" render={<a href={item.url} target="_blank" rel="noopener" />}><ExternalLink /> {item.repo && onAzure(item.repo) ? 'Azure DevOps' : 'GitHub'}</Button>}
          <StatusAction item={item} data={data} />
        </span>
      </DialogFooter>
    </>
  );
}

export function ItemDialog() {
  const { data, now } = useBoardStore();
  const { itemId, close } = useItemDialogStore();
  const opened = data.items.find((i) => i.id === itemId);
  // An item that left the board closes the dialog for good, so a later read that brings it back doesn't reopen it.
  useEffect(() => {
    if (itemId && !opened) close();
  }, [itemId, opened, close]);
  // The last item stays in the dialog while it animates closed.
  const kept = useRef(opened);
  if (opened) kept.current = opened;
  const item = kept.current;
  return (
    <Dialog open={Boolean(opened)} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-2xl" data-item-dialog>
        {item && <ItemDialogBody item={item} data={data} now={now} />}
      </DialogPopup>
    </Dialog>
  );
}
