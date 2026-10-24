// PROTOTYPE, throwaway. Variant A, "T3 twin": the board as T3 Code's own shell. The sidebar lists items the
// way T3 lists threads (grouped like projects, a glyph for working/waiting/done), and the main pane shows the
// picked item as T3 shows a thread. Settings, Pull requests and Usage sit at the sidebar's foot, as in T3.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChartColumn, ChevronDown, ChevronRight, GitPullRequest, PanelLeft, Plus, Search, Settings } from 'lucide-react';
import { boardSections, duration, formatUsd, plural, platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { BrandRow, Button, IconButton, Kbd, PlatformDot, PlatformTag, SidebarButton, StatusGlyph, drag, noDrag } from './chrome.tsx';
import { ActionButtons, PrList, SliceList, StatsGrid, StepTrack, hint, refText, statsOf } from './item-bits.tsx';
import { SettingsBody, SettingsHeader, SettingsNav, pages } from './proto-settings.tsx';

function Group({ title, count, amber, children, open: byDefault = true }: { title: string; count: number; amber?: boolean; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(byDefault);
  return (
    <div className="mb-1">
      <button type="button" onClick={() => setOpen(!open)} className="group flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-(--sidebar-muted) hover:bg-(--row-hover)">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className={amber && count ? 'text-(--warning-foreground)' : ''}>{title}</span>
        <span className="ml-auto tabular-nums">{count}</span>
      </button>
      {open && <div className="flex flex-col gap-px">{children}</div>}
    </div>
  );
}

function ItemRow({ item, data, now, active, onPick }: { item: Item; data: BoardData; now: number; active: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick}
      className={`flex h-7 w-full items-center gap-2 rounded-md pl-5 pr-2 text-left hover:bg-(--row-hover) ${active ? 'bg-(--row-active)' : ''}`}>
      <StatusGlyph status={item.status} />
      <span className={`min-w-0 flex-1 truncate ${active ? 'font-medium' : ''}`}>{item.title}</span>
      <PlatformDot item={item} data={data} />
      <span className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-(--muted-foreground)">{shortAgo(item.updatedAt, now)}</span>
    </button>
  );
}

function Detail({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const h = hint(item);
  return (
    <>
      <header className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-(--border) px-4 ${drag}`}>
        <PlatformTag platform={platformOf(item, data.repos)} />
        <span className="text-(--muted-foreground) tabular-nums">{refText(item)}</span>
        <span className="min-w-0 truncate font-medium">{item.title}</span>
        <span className={`ml-auto ${noDrag}`}><ActionButtons item={item} /></span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-6 px-8 py-8">
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-xs text-(--muted-foreground)">
              <StatusGlyph status={item.status} /> <span className="font-medium text-(--foreground)">{item.status}</span> · updated {shortAgo(item.updatedAt, now)}
              {item.blockedBy > 0 && <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)">blocked by {item.blockedBy}</span>}
            </div>
            <h1 className="m-0 text-xl font-semibold tracking-tight">{item.title}</h1>
            {item.parent && <p className="m-0 text-(--muted-foreground)">Part of <a href={item.parent.url} className="underline">#{item.parent.number} {item.parent.title}</a></p>}
          </div>
          <StepTrack status={item.status} labels />
          {h && (
            <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-4 py-3">
              <StatusGlyph status={item.status} className="size-4" />
              <span className="flex-1 font-medium text-(--warning-foreground)">{h}</span>
              <ActionButtons item={item} small />
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
        </div>
      </div>
    </>
  );
}

function Usage({ data }: { data: BoardData }) {
  const rows = data.items.filter((i) => statsOf(i)).sort((a, b) => (statsOf(b)!.costUsd ?? 0) - (statsOf(a)!.costUsd ?? 0));
  const total = rows.reduce((t, i) => t + (statsOf(i)!.costUsd ?? 0), 0);
  return (
    <>
      <header className={`flex h-[52px] shrink-0 items-center border-b border-(--border) px-4 font-medium ${drag}`}>Usage</header>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto grid max-w-3xl gap-4 px-8 py-8">
        <p className="m-0 text-2xl font-semibold tabular-nums">{formatUsd(total)} <span className="text-sm font-normal text-(--muted-foreground)">across {plural(rows.length, 'item')}</span></p>
        <div className="divide-y divide-(--border) rounded-xl border border-(--border) bg-(--card)">
          {rows.map((i) => <div key={i.id} className="flex items-center gap-3 px-4 py-2"><StatusGlyph status={i.status} /><span className="min-w-0 flex-1 truncate">{i.title}</span><span className="text-xs text-(--muted-foreground) tabular-nums">{duration(statsOf(i)!.agentMs)}</span><span className="w-16 text-right tabular-nums">{formatUsd(statsOf(i)!.costUsd ?? 0)}</span></div>)}
        </div>
      </div></div>
    </>
  );
}

export function VariantA() {
  const { data, now } = useBoardStore();
  const s = boardSections(data, now);
  const [picked, setPicked] = useState<string | null>(s.needsYou[0]?.id ?? s.inFlight[0]?.id ?? null);
  const [view, setView] = useState<'board' | 'settings' | 'usage'>('board');
  const all = pages(data);
  const [page, setPage] = useState('general');
  const item = data.items.find((i) => i.id === picked);
  const row = (i: Item) => <ItemRow key={i.id} item={i} data={data} now={now} active={view === 'board' && i.id === picked} onPick={() => { setPicked(i.id); setView('board'); }} />;
  const prs = data.items.reduce((n, i) => n + i.linkedPrs.length, 0);
  return (
    <div className="proto fixed inset-0 flex bg-(--background) text-(--foreground)">
      <aside className="flex w-[268px] shrink-0 flex-col border-r border-(--border) bg-(--sidebar)">
        <BrandRow><IconButton label="Toggle sidebar"><PanelLeft /></IconButton></BrandRow>
        {view === 'settings' ? (
          <SettingsNav all={all} current={page} onPick={setPage} onBack={() => setView('board')} />
        ) : (
          <>
            <div className="grid gap-1 px-2 pb-2">
              <SidebarButton icon={<Plus />} label="New item" trailing={<Kbd>⌘N</Kbd>} />
              <SidebarButton icon={<Search />} label="Search items" trailing={<Kbd>⌘K</Kbd>} />
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-2">
              <Group title="Needs you" count={s.needsYou.length} amber>{s.needsYou.map(row)}</Group>
              <Group title="In flight" count={s.inFlight.length}>{s.inFlight.map(row)}</Group>
              <Group title="Concepts" count={s.concepts.length}>{s.concepts.map(row)}</Group>
              <Group title="Queued" count={s.queued.length}>{s.queued.map(row)}</Group>
              {s.listGroups.map((g) => <Group key={g.id} title={`List · ${g.platform}`} count={g.items.length} open={false}>{g.items.map(row)}</Group>)}
              <Group title="Done this week" count={s.done.length} open={false}>{s.done.map(row)}</Group>
            </nav>
            <div className="border-t border-(--border) p-2">
              <SidebarButton icon={<Settings />} label="Settings" onClick={() => setView('settings')} />
              <SidebarButton icon={<GitPullRequest />} label="Pull requests" trailing={<span className="text-[11px] text-(--muted-foreground)">{prs}</span>} />
              <SidebarButton icon={<ChartColumn />} label="Usage" active={view === 'usage'} onClick={() => setView('usage')} />
            </div>
          </>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {view === 'settings' ? (
          <>
            <SettingsHeader page={all.find((p) => p.id === page)!} />
            <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-2xl px-8 py-8"><SettingsBody page={all.find((p) => p.id === page)!} /></div></div>
          </>
        ) : view === 'usage' ? <Usage data={data} /> : item ? <Detail item={item} data={data} now={now} /> : (
          <div className={`grid flex-1 place-items-center text-(--muted-foreground) ${drag}`}><span>Pick an item. <Button small>New item</Button></span></div>
        )}
      </main>
    </div>
  );
}
