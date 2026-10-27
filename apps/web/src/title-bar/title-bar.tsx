// The main area's title bar: a 52 px drag bar with the scope menu ("All repositories", or the repository the menu or
// the sidebar scoped it to), the Refreshed time, the counters, the List button and This week. While the sidebar is hidden it starts
// T3's gap past the toggle. Clicks on its buttons and on the time never drag the window; the rest of the bar does.
// Above the missing-t3 notice there's no board to scope or count, so the bar is empty.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { boardSections, clock, failedCheck, isStale, repoName, shortAgo } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';
import { Menu, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuSeparator, MenuTrigger } from '@lar-factory/ui/menu';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/tooltip';
import { useBoardStore } from '../board/board-store.ts';
import { repoTone } from '../items/item-parts.tsx';
import { ListButton } from '../list/list-modal.tsx';
import { useSidebarStore } from '../sidebar/sidebar-store.ts';
import { useTitlebarInset } from '../sidebar/window-controls.tsx';
import { Counters } from './counters.tsx';

const NO_DRAG = '[-webkit-app-region:no-drag]';
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-1 focus-visible:ring-offset-(--background)';

/** The menu that sets the scope: All repositories, then a repository for each sidebar group, in the sidebar's order. */
function Scope() {
  const data = useBoardStore((state) => state.data);
  const now = useBoardStore((state) => state.now);
  const { scope, setScope } = useSidebarStore();
  const groups = boardSections(data, now).listGroups;
  const shown = scope ? repoName(scope, data.repos) : 'All repositories';
  return (
    <Menu modal={false}>
      <MenuTrigger render={<button type="button" />} aria-label={`Scope: ${shown}`}
        className={`scope -ml-1.5 inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-sm font-medium hover:bg-(--accent) data-[popup-open]:bg-(--accent) ${FOCUS_RING} ${NO_DRAG}`}>
        {shown}
        <ChevronDown className="size-3.5 text-(--muted-foreground)" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={scope ?? ''} onValueChange={(value: string) => setScope(value || null)}>
          <MenuGroupLabel>Show</MenuGroupLabel>
          <MenuRadioItem value="" closeOnClick>
            <span className="flex items-center gap-2"><span className="flex-1">All repositories</span><MenuRadioItemIndicator /></span>
          </MenuRadioItem>
          <MenuSeparator />
          {groups.map(({ repo, name }) => (
            <MenuRadioItem key={repo} value={repo} closeOnClick>
              <span className="flex items-center gap-2">
                <span className={`${repoTone(repo, data.repos)} size-2 shrink-0 rounded-full bg-[var(--k,var(--muted-foreground))]`} aria-hidden="true" />
                <span className="flex-1">{name}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

type Health = 'waiting' | 'live' | 'stale';
const DOT = { waiting: 'bg-(--muted-foreground)/50', live: 'bg-success', stale: 'bg-amber-500' } as const;

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
      <span data-line className="text-(--muted-foreground)">
        {data.error ? `Last read failed: ${data.error.split('\n')[0]}` : `Reads every ${data.refreshSeconds}s`}
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
      <TooltipTrigger render={<span tabIndex={0} />}
        className={`refreshed inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm text-xs tabular-nums text-(--muted-foreground) ${FOCUS_RING} ${NO_DRAG}`}>
        <span className="relative grid size-2 place-items-center">
          {landed > 0 && health === 'live' && (
            <span key={landed} data-ping className="absolute size-1.5 rounded-full bg-success motion-safe:animate-[refreshed-ping_1.2s_ease-out_forwards]" />
          )}
          <span data-dot className={`size-1.5 rounded-full ${DOT[health]}`} />
        </span>
        {!fetchedAt ? 'Not read yet' : <time dateTime={fetchedAt}>{health === 'stale' ? `Stale · ${ago}` : ago}</time>}
      </TooltipTrigger>
      <TooltipPopup side="bottom"><RefreshDetails data={data} now={now} /></TooltipPopup>
    </Tooltip>
  );
}

export function TitleBar() {
  const data = useBoardStore((state) => state.data);
  const inset = useTitlebarInset();
  return (
    <header className={`title-bar flex h-13 shrink-0 select-none items-center gap-2 border-b border-(--border) pr-3 ${inset} [-webkit-app-region:drag]`}>
      {failedCheck(data.tools, 't3')?.result !== 'missing' && (
        <>
          {/* The sidebar's brand is hidden from screen readers, so the page's heading is here, for them only. A closing dialog
              whose opener went away puts focus on it. */}
          <h1 className="sr-only" tabIndex={-1}>Lar Factory</h1>
          <Scope />
          <Refreshed data={data} />
          <div className="flex min-w-0 flex-1 items-center justify-center"><Counters /></div>
          <span className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
            <ListButton />
            <Button variant="outline" size="xs" disabled title="This week isn't built yet">This week</Button>
          </span>
        </>
      )}
    </header>
  );
}
