// The board's title bar, laid out as lar-server's AppTitleBar on the copied TitleBar: on the left the brand, the scope
// menu ("All repositories", or the repository the menu or the List modal scoped it to) and the Refreshed time; on the
// right the counters, the List button, Add item, the "for T3 Code" tag, the update pill while there's an update, and
// Settings. Every control is 28 px tall (./control.ts). It starts past the traffic lights and drags the window, except
// on its controls. Above the missing-t3 notice there's no board to scope, count or add to, so it holds only the brand
// and Settings.
// Every control keeps its own width, and the bar folds by its own width (the copied TitleBar is the container
// queried) instead: the "for T3 Code" tag and the List and Add item labels (kept for screen readers) go first, then
// Spend, Queued and Shipped, then the Refreshed text, and on a narrow page Building and the Refreshed dot. Scope
// truncates in what's left.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { boardSections, clock, failedCheck, isStale, repoName, shortAgo } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { BrandMark } from '@lar-factory/ui/design-system/BrandMark';
import { Button } from '@lar-factory/ui/design-system/Button';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { TitleBar as LarTitleBar } from '@lar-factory/ui/design-system/TitleBar';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';
import { AddItem } from '../add-item/add-item.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { useScopeStore } from '../board/scope-store.ts';
import { repoTone } from '../items/item-parts.tsx';
import { ListButton } from '../list/list-modal.tsx';
import { SettingsButton } from '../settings/settings.tsx';
import { UpdateButton } from '../updates/UpdateButton.tsx';
import { CONTROL } from './control.ts';
import { Counters } from './counters.tsx';
import { TrafficLights, useWindowControlsInset } from './window-controls.tsx';

/** "lar Factory": the copied BrandMark, the mark and "lar", then a muted "Factory" on the same baseline, in
 *  BrandMark's size and type. Screen readers skip it: the page's hidden h1 names the page. */
function Brand() {
  return (
    <span className="brand lar-brand-mark inline-flex shrink-0 items-baseline text-xl leading-none" aria-hidden="true">
      <BrandMark label="lar" />
      <span className="ml-[0.24em] font-medium tracking-[-0.02em] text-base-700">Factory</span>
    </span>
  );
}

/** The menu that sets the scope: All repositories, then a repository for each List group, in the List's order. */
function Scope() {
  const data = useBoardStore((state) => state.data);
  const now = useBoardStore((state) => state.now);
  const { scope, setScope } = useScopeStore();
  const groups = boardSections(data, now).listGroups;
  const shown = scope ? repoName(scope, data.repos) : 'All repositories';
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button variant="quiet" className={`scope ${CONTROL} min-w-0 px-2`} aria-label={`Scope: ${shown}`} rightIcon={<ChevronDown />}>
          <span className="min-w-0 truncate">{shown}</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Label>Show</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={scope ?? ''} onValueChange={(value) => setScope(value || null)}>
          <DropdownMenu.RadioItem value="">All repositories</DropdownMenu.RadioItem>
          <DropdownMenu.Separator />
          {groups.map(({ repo, name }) => (
            <DropdownMenu.RadioItem key={repo} value={repo}>
              <span className={`${repoTone(repo, data.repos)} size-2 shrink-0 rounded-full bg-[var(--k,var(--muted-foreground))]`} aria-hidden="true" />
              {name}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

type Health = 'waiting' | 'live' | 'stale';
const DOT = { waiting: 'bg-base-500', live: 'bg-success', stale: 'bg-amber-500' } as const;

/** How many reads landed after this page opened: a newer `fetchedAt` than the one shown. */
function useLandedReads(fetchedAt: string | null) {
  const [landed, setLanded] = useState(0);
  const shown = useRef(fetchedAt);
  useEffect(() => {
    const before = shown.current;
    shown.current = fetchedAt;
    if (fetchedAt && (!before || Date.parse(fetchedAt) > Date.parse(before))) setLanded((count) => count + 1);
  }, [fetchedAt]);
  return landed;
}

function RefreshDetails({ data, now }: { data: BoardData; now: number }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span data-line>{data.fetchedAt ? `Updated ${shortAgo(data.fetchedAt, now)} · ${clock(data.fetchedAt, undefined)}` : 'Not read yet'}</span>
      <span data-line className="text-base-700">
        {data.error ? `Last read failed: ${data.error.split('\n')[0]}` : `Checks GitHub for changes every 5s, reads everything every ${data.refreshSeconds}s`}
      </span>
    </span>
  );
}

/** Counts up each second on its own timer, so the rest of the board keeps the store's slower clock. A tab stop, so
 *  keyboard users reach its tooltip. Only the dot changes colour (amber when stale) and only the dot pings. */
function Refreshed({ data }: { data: BoardData }) {
  const { fetchedAt } = data;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [fetchedAt]);
  const landed = useLandedReads(fetchedAt);
  const health: Health = isStale(data, now) ? 'stale' : fetchedAt ? 'live' : 'waiting';
  const ago = fetchedAt ? shortAgo(fetchedAt, now) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}
          className="refreshed inline-flex h-7 shrink-0 @max-[40rem]:hidden items-center gap-1.5 whitespace-nowrap rounded-sm px-1 text-xs tabular-nums text-base-700 outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span className="relative grid size-2 place-items-center">
            {landed > 0 && health === 'live' && (
              <span key={landed} data-ping className="absolute size-1.5 rounded-full bg-success motion-safe:animate-[refreshed-ping_1.2s_ease-out_forwards]" />
            )}
            <span data-dot className={`size-1.5 rounded-full ${DOT[health]}`} />
          </span>
          <span className="@max-[48rem]:sr-only">
            {!fetchedAt ? 'Not read yet' : <time dateTime={fetchedAt}>{health === 'stale' ? `Stale · ${ago}` : ago}</time>}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom"><RefreshDetails data={data} now={now} /></TooltipPopup>
    </Tooltip>
  );
}

/** The window drags from the bar, but never from a control in it. */
const DRAG = '[-webkit-app-region:drag] [&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]';

export function TitleBar() {
  const board = useBoardStore((state) => failedCheck(state.data.tools, 't3')?.result !== 'missing');
  const data = useBoardStore((state) => state.data);
  const inset = useWindowControlsInset();
  return (
    <div className={`title-bar shrink-0 select-none border-b border-base-300 ${inset} ${DRAG}`}>
      <TrafficLights />
      {/* The brand is hidden from screen readers, so the page's heading is here, for them only. A closing dialog whose
          opener went away puts focus on it. The missing-t3 notice has its own. */}
      {board && <h1 className="sr-only" tabIndex={-1}>Lar Factory</h1>}
      <LarTitleBar
        brand={<Brand />}
        title={board && (
          <>
            <Scope />
            <Refreshed data={data} />
          </>
        )}
        actions={(
          <>
            {board && (
              <>
                <Counters />
                <ListButton />
                <AddItem />
                <Badge className="t3-tag h-7 px-2 @max-[70rem]:hidden [.title-bar:has(.update-button)_&]:@max-[74rem]:hidden">for T3 Code</Badge>
                <UpdateButton />
              </>
            )}
            <SettingsButton />
          </>
        )}
      />
    </div>
  );
}
