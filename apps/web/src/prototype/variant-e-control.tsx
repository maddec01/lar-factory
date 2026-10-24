// PROTOTYPE, throwaway. Variant E, "Control room": C's overview with A's detail. The window stays a
// dashboard (stats in the header, your desk, the line as stations, the List by repo in the sidebar), and clicking any item, in
// the sidebar, on the desk or on the line, opens A's full detail in a dialog over the
// overview. The left sidebar copies T3 Code's: its toggle beside the traffic lights, search with Add item,
// Settings and the update button at its foot. ⌘B toggles the sidebar.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search, Settings, SquarePen, X } from 'lucide-react';
import { boardApp, boardSections, platformOf, shortAgo } from '@mux-factory/shared';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@mux-factory/ui/dialog';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import type { BoardData, Item } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { UpdateButton } from '../updates/UpdateButton.tsx';
import { UpdateStatusIcon } from '../updates/UpdateStatusIcon.tsx';
import { BRAND_LEFT, Brand, Button, PlatformTag, StatusGlyph, WindowControls, drag, noDrag } from './chrome.tsx';
import { ActionButtons, PrList, SliceList, ItemTitle, StatsGrid, StepTrack, hint } from './item-bits.tsx';
import { ToolbarStats } from './toolbar-stats.tsx';
import { ListSidebar } from './list-sidebar.tsx';
import { Line } from './line/line.tsx';
import type { Pick } from './list-sidebar.tsx';
import { SettingsBody, SettingsHeader, SettingsNav, pages } from './proto-settings.tsx';

const picked = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : '');

function DeskCard({ item, data, now, pick }: { item: Item; data: BoardData; now: number; pick: Pick }) {
  return (
    <button type="button" onClick={() => pick.set(item.id)}
      className={`grid w-[280px] shrink-0 gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) p-3.5 text-left shadow-[inset_3px_0_0_var(--warning)] hover:bg-(--accent) ${picked(pick.id === item.id)}`}>
      <span className="flex items-center gap-2 text-xs">
        <StatusGlyph status={item.status} /><span className="font-semibold text-(--warning-foreground)">{item.status}</span>
        <span className="truncate text-(--muted-foreground)">· {platformOf(item, data.repos)} · {shortAgo(item.updatedAt, now)}</span>
      </span>
      <span className="line-clamp-2 font-medium leading-snug"><ItemTitle item={item} /></span>
      <span className="text-xs text-(--muted-foreground)">{hint(item)}</span>
      <StepTrack status={item.status} />
    </button>
  );
}

function ItemDialog({ item: opened, data, now, onClose }: { item: Item | undefined; data: BoardData; now: number; onClose: () => void }) {
  // The last item stays in the dialog while it animates closed.
  const kept = useRef(opened);
  if (opened) kept.current = opened;
  const item = kept.current;
  const h = item && hint(item);
  return (
    <Dialog open={!!opened} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-8 text-xs text-(--muted-foreground)">
                <PlatformTag platform={platformOf(item, data.repos)} />
                <StatusGlyph status={item.status} /> <span className="font-medium text-(--foreground)">{item.status}</span> · updated {shortAgo(item.updatedAt, now)}
                {item.blockedBy > 0 && <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)">blocked by {item.blockedBy}</span>}
              </div>
              <DialogTitle className="text-lg leading-snug tracking-tight"><ItemTitle item={item} /></DialogTitle>
              {item.parent && <DialogDescription>Part of <a href={item.parent.url} className="underline">#{item.parent.number} {item.parent.title}</a></DialogDescription>}
            </DialogHeader>
            <DialogPanel className="grid gap-5 space-y-0">
              <StepTrack status={item.status} labels />
              {h && (
                <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5">
                  <StatusGlyph status={item.status} className="size-4" />
                  <span className="flex-1 font-medium text-(--warning-foreground)">{h}</span>
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
            </DialogPanel>
            <DialogFooter><ActionButtons item={item} /></DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

/** T3's SidebarHeaderIconButton: a 28 px icon button in the sidebar's icon colour, its label in a tooltip. */
function SidebarIconButton({ label, children, onClick, side = 'top' }: { label: string; children: ReactNode; onClick?: () => void; side?: 'top' | 'bottom' }) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <button type="button" aria-label={label} onClick={onClick}
          className="grid size-7 shrink-0 place-items-center rounded-(--control-radius) text-(--sidebar-icon-color) hover:bg-(--sidebar-row-hover) hover:text-(--sidebar-foreground) [&_svg]:size-4" />
      }>{children}</TooltipTrigger>
      <TooltipPopup side={side}>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** T3's search field over the thread list, with its new-thread button, here Add item, on the right. */
function SearchRow({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-(--control-radius) px-2 py-1.5 text-sm font-medium text-(--sidebar-muted-foreground) hover:bg-(--sidebar-row-hover) hover:text-(--sidebar-foreground)">
        <Search className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search List" aria-label="Search List items"
          className="min-w-0 flex-1 bg-transparent font-medium text-(--sidebar-foreground) outline-none placeholder:text-(--sidebar-muted-foreground) [&::-webkit-search-cancel-button]:hidden" />
        {query && <button type="button" aria-label="Clear search" onClick={() => onQuery('')} className="grid size-5 place-items-center rounded-sm text-(--muted-foreground) hover:bg-(--accent)"><X className="size-3" /></button>}
      </label>
      <SidebarIconButton label="Add item (⌘N)"><SquarePen /></SidebarIconButton>
    </div>
  );
}

/** The board app's update button, T3's update pill; in a browser, where it hides, a still stand-in. */
function Update() {
  if (boardApp()) return <UpdateButton />;
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label="Check for updates" className="inline-flex size-8 items-center justify-center rounded-full text-(--sidebar-icon-color) hover:bg-(--update-hover) hover:text-(--foreground)" />}>
        <UpdateStatusIcon status="idle" />
      </TooltipTrigger>
      <TooltipPopup side="top">Check for updates</TooltipPopup>
    </Tooltip>
  );
}

export function VariantE() {
  const { data, now } = useBoardStore();
  const [platform, setPlatform] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const all = pages(data);
  const [page, setPage] = useState('general');
  const [sidebar, setSidebar] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const pick: Pick = { id: opened, set: setOpened };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebar((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const scoped: BoardData = platform ? { ...data, items: data.items.filter((i) => platformOf(i, data.repos) === platform) } : data;
  const s = boardSections(scoped, now);
  const item = data.items.find((i) => i.id === opened);
  const current = all.find((p) => p.id === page)!;
  const q = query.trim().toLowerCase();
  return (
    <div className="proto fixed inset-0 flex bg-(--background) text-(--foreground)">
      <WindowControls open={sidebar} onToggle={() => setSidebar(!sidebar)} />
      {sidebar && (
        <aside className="relative flex w-75 shrink-0 flex-col border-r border-(--sidebar-border) bg-(--sidebar) text-(--sidebar-foreground)">
          <div className={`flex h-[52px] shrink-0 items-center pr-3 ${BRAND_LEFT} ${drag}`}><Brand /></div>
          {settings ? (
            <>
              <SettingsNav all={all} current={page} onPick={setPage} onBack={() => setSettings(false)} />
              <span className="absolute bottom-2 right-2"><Update /></span>
            </>
          ) : (
            <>
              <div className="px-2 pb-2"><SearchRow query={query} onQuery={setQuery} /></div>
              <ListSidebar data={data} now={now} query={q} platform={platform} onScope={setPlatform} pick={pick} />
              <div className="flex items-center justify-between px-2 py-2">
                <SidebarIconButton label="Settings" onClick={() => setSettings(true)}><Settings /></SidebarIconButton>
                <Update />
              </div>
            </>
          )}
        </aside>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        {settings ? (
          <>
            <SettingsHeader page={current} leading={sidebar ? undefined : <span className="w-[86px] shrink-0" />} />
            <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-2xl px-8 py-8"><SettingsBody page={current} /></div></div>
          </>
        ) : (
          <>
            <header className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-(--border) pr-3 ${sidebar ? 'pl-4' : BRAND_LEFT} ${drag}`}>
              <span className="font-medium">{platform ?? 'Whole factory'}</span>
              {platform && <button type="button" aria-label="Show the whole factory" onClick={() => setPlatform(null)} className={`grid size-5 place-items-center rounded-sm text-(--muted-foreground) hover:bg-(--accent) ${noDrag}`}><X className="size-3" /></button>}
              <span className="text-xs text-(--muted-foreground)">{data.fetchedAt ? `refreshed ${shortAgo(data.fetchedAt, now)}` : ''}</span>
              <div className="flex min-w-0 flex-1 items-center justify-center"><ToolbarStats data={data} now={now} open={setOpened} /></div>
              <span className={`flex items-center gap-1.5 ${noDrag}`}>
                <Button small>This week</Button>
              </span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-7 px-6 py-5">
                <section className="grid gap-3">
                  <h2 className="m-0 text-[13px] font-medium">Your desk <span className="text-(--muted-foreground)">{s.needsYou.length}</span></h2>
                  {s.needsYou.length
                    ? <div className="flex gap-3 overflow-x-auto p-1">{s.needsYou.map((i) => <DeskCard key={i.id} item={i} data={data} now={now} pick={pick} />)}</div>
                    : <p className="m-0 rounded-xl border border-dashed border-(--input) p-6 text-center text-(--muted-foreground)">Desk clear. The line runs without you.</p>}
                </section>
                <section className="grid gap-3">
                  <h2 className="m-0 text-[13px] font-medium">The line</h2>
                  <Line items={scoped.items} data={data} now={now} pick={pick} />
                </section>
              </div>
            </div>
          </>
        )}
      </main>
      <ItemDialog item={item} data={data} now={now} onClose={() => setOpened(null)} />
    </div>
  );
}
