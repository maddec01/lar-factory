// PROTOTYPE, throwaway. Variant B, "Flow lanes": a real kanban. One title bar across the window (traffic
// lights, brand, platform filter, refresh and Add), T3's sidebar collapsed to an icon rail with Settings at its
// foot, and a lane per status from Queued to Ready to merge, each with its own limit. List is a tray at the bottom.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChartColumn, ChevronUp, Columns3, GitPullRequest, Inbox, Plus, Search, Settings } from 'lucide-react';
import { boardSections, platformOf, plural, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { Button, IconButton, Logo, PlatformDot, StatusGlyph, TrafficLights, drag, noDrag, platformColor } from './chrome.tsx';
import { ChecksDot, SliceBar, primaryAction, refText } from './item-bits.tsx';
import { SettingsBody, SettingsHeader, SettingsNav, pages } from './proto-settings.tsx';

const LANES: { status: Status; limit?: number; you?: boolean }[] = [
  { status: 'Queued' }, { status: 'Shaping' }, { status: 'Needs you', you: true }, { status: 'Ready' },
  { status: 'In progress', limit: 2 }, { status: 'Review' }, { status: 'Verify', you: true }, { status: 'Ready to merge', you: true },
];

function LaneCard({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const action = primaryAction(item);
  return (
    <article className="group grid gap-2 rounded-lg border border-(--border) bg-(--card) p-2.5 shadow-xs hover:border-(--input)">
      <div className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)">
        <PlatformDot item={item} data={data} /><span className="tabular-nums">{refText(item)}</span>
        {item.blockedBy > 0 && <span className="text-(--error-foreground)">· blocked</span>}
        <span className="ml-auto">{shortAgo(item.updatedAt, now)}</span>
      </div>
      <a href={item.url ?? undefined} target="_blank" rel="noopener" className="line-clamp-2 font-medium leading-snug hover:underline">{item.title}</a>
      <SliceBar item={item} />
      <div className="flex items-center gap-2">
        <ChecksDot item={item} />
        {item.subIssues.total > 0 && <span className="text-[11px] text-(--muted-foreground)">{item.subIssues.completed}/{item.subIssues.total} subs</span>}
        {action && <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"><Button small primary={['Answer in T3', 'Verify build', 'Merge PR', 'Start'].includes(action)}>{action}</Button></span>}
      </div>
    </article>
  );
}

function Lane({ lane, items, data, now }: { lane: (typeof LANES)[number]; items: Item[]; data: BoardData; now: number }) {
  const over = lane.limit !== undefined && items.length > lane.limit;
  return (
    <section className={`flex w-[264px] shrink-0 flex-col rounded-xl ${lane.you && items.length ? 'bg-(--warning-surface)' : 'bg-(--muted)'}`}>
      <h2 className="m-0 flex h-10 items-center gap-2 px-3 text-xs font-medium">
        <StatusGlyph status={lane.status} />{lane.status}
        <span className={`tabular-nums ${over ? 'font-semibold text-(--error-foreground)' : 'text-(--muted-foreground)'}`}>{items.length}{lane.limit !== undefined && `/${lane.limit}`}</span>
        {lane.you && <span className="ml-auto rounded bg-(--card) px-1.5 text-[10px] text-(--warning-foreground)">you</span>}
      </h2>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-2 pb-2">
        {items.map((i) => <LaneCard key={i.id} item={i} data={data} now={now} />)}
        {!items.length && <p className="m-0 rounded-lg border border-dashed border-(--input) p-3 text-center text-xs text-(--muted-foreground)">Empty</p>}
      </div>
    </section>
  );
}

export function VariantB() {
  const { data, now } = useBoardStore();
  const s = boardSections(data, now);
  const [platform, setPlatform] = useState<string | null>(null);
  const [tray, setTray] = useState(false);
  const [settings, setSettings] = useState(false);
  const all = pages(data);
  const [page, setPage] = useState('general');
  const shown = (items: Item[]) => (platform ? items.filter((i) => platformOf(i, data.repos) === platform) : items);
  const open = shown(data.items.filter((i) => i.status !== 'Done' && i.status !== 'List'));
  const rail = (icon: ReactNode, label: string, active = false, onClick?: () => void) => (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      className={`grid size-9 place-items-center rounded-lg [&_svg]:size-[18px] ${active ? 'bg-(--row-active) text-(--foreground)' : 'text-(--muted-foreground) hover:bg-(--row-hover) hover:text-(--foreground)'}`}>{icon}</button>
  );
  return (
    <div className="proto fixed inset-0 flex flex-col bg-(--background) text-(--foreground)">
      <header className={`flex h-[52px] shrink-0 items-center gap-3 border-b border-(--border) bg-(--sidebar) pl-4 pr-3 ${drag}`}>
        <TrafficLights />
        <span className="inline-flex items-baseline gap-1 text-sm font-medium"><Logo /><span className="text-(--muted-foreground)">Factory</span></span>
        <span className={`mx-auto inline-flex rounded-lg bg-(--accent) p-0.5 ${noDrag}`}>
          {[null, ...data.repos.map((r) => r.platform)].map((p) => (
            <button key={p ?? 'all'} type="button" onClick={() => setPlatform(p)}
              className={`flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${platform === p ? 'bg-(--card) shadow-sm' : 'text-(--muted-foreground)'}`}>
              {p && <span className="size-1.5 rounded-full" style={{ background: platformColor(p) }} />}{p ?? 'All'}
            </button>
          ))}
        </span>
        <span className={`flex items-center gap-1 ${noDrag}`}>
          <span className="mr-1 text-xs text-(--muted-foreground)">{data.fetchedAt ? `Refreshed ${shortAgo(data.fetchedAt, now)}` : ''}</span>
          <IconButton label="Search"><Search /></IconButton>
          <Button small primary><Plus /> Add item</Button>
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-(--border) bg-(--sidebar) py-2">
          {rail(<Columns3 />, 'Lanes', !settings, () => setSettings(false))}
          {rail(<Inbox />, `Needs you (${s.needsYou.length})`)}
          {rail(<GitPullRequest />, 'Pull requests')}
          {rail(<ChartColumn />, 'Usage')}
          <span className="mt-auto">{rail(<Settings />, 'Settings', settings, () => setSettings(true))}</span>
        </nav>
        {settings && (
          <aside className="flex w-[232px] shrink-0 flex-col border-r border-(--border) bg-(--sidebar) pt-2">
            <SettingsNav all={all} current={page} onPick={setPage} onBack={() => setSettings(false)} />
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          {settings ? (
            <>
              <SettingsHeader page={all.find((p) => p.id === page)!} />
              <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-2xl px-8 py-8"><SettingsBody page={all.find((p) => p.id === page)!} /></div></div>
            </>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
                {LANES.map((l) => <Lane key={l.status} lane={l} items={open.filter((i) => i.status === l.status)} data={data} now={now} />)}
                <section className="flex w-[200px] shrink-0 flex-col gap-1 rounded-xl border border-dashed border-(--input) p-3 text-xs text-(--muted-foreground)">
                  <span className="flex items-center gap-2 font-medium text-(--foreground)"><StatusGlyph status="Done" /> Done this week <span className="text-(--muted-foreground)">{shown(s.done).length}</span></span>
                  {shown(s.done).map((i) => <span key={i.id} className="truncate line-through">{i.title}</span>)}
                </section>
              </div>
              <footer className="shrink-0 border-t border-(--border) bg-(--sidebar)">
                <button type="button" onClick={() => setTray(!tray)} className="flex h-9 w-full items-center gap-2 px-4 text-xs font-medium hover:bg-(--row-hover)">
                  <ChevronUp className={`size-3.5 transition-transform ${tray ? 'rotate-180' : ''}`} />
                  List <span className="text-(--muted-foreground)">{plural(shown(s.list).length, 'item')} waiting to be queued</span>
                  <span className="ml-auto flex gap-1">{shown(s.list).slice(0, 12).map((i) => <span key={i.id} className="size-2 rounded-full" style={{ background: platformColor(platformOf(i, data.repos)) }} />)}</span>
                </button>
                {tray && (
                  <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-1 overflow-y-auto px-3 pb-3">
                    {shown(s.list).map((i) => (
                      <div key={i.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-(--row-hover)">
                        <PlatformDot item={i} data={data} /><span className="text-(--muted-foreground) tabular-nums">{refText(i)}</span>
                        <span className="min-w-0 flex-1 truncate">{i.title}</span><Button small>Queue</Button>
                      </div>
                    ))}
                  </div>
                )}
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
