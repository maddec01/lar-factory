// PROTOTYPE, throwaway. Variant C, "Factory floor": the board as a control room. The sidebar lists repos the
// way T3 lists projects (each opens to its live items), with Settings, Pull requests and Usage at its foot.
// The main pane leads with your desk (only what needs you, one big action each), then the line itself as
// stations with items sitting at them, then WIP and the week's throughput and spend.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ChartColumn, ChevronDown, ChevronRight, GitPullRequest, Plus, Settings } from 'lucide-react';
import { STATUSES, boardSections, formatUsd, platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { BrandRow, Button, IconButton, SidebarButton, StatusGlyph, STATUS_COLOR, drag, noDrag, platformColor } from './chrome.tsx';
import { ActionButtons, SliceBar, StepTrack, hint, refText, statsOf } from './item-bits.tsx';
import { SettingsBody, SettingsHeader, SettingsNav, pages } from './proto-settings.tsx';

const STATIONS: Status[] = ['Queued', 'Shaping', 'Ready', 'In progress', 'Review', 'Verify', 'Ready to merge'];

function Repo({ platform, repo, items, now, active, onPick }: { platform: string; repo: string; items: Item[]; now: number; active: boolean; onPick: () => void }) {
  const [open, setOpen] = useState(true);
  const live = items.filter((i) => i.status !== 'List' && i.status !== 'Done');
  const you = items.filter((i) => ['Needs you', 'Verify', 'Ready to merge'].includes(i.status)).length;
  return (
    <div className="mb-1">
      <div className={`flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-(--row-hover) ${active ? 'bg-(--row-active)' : ''}`}>
        <button type="button" onClick={() => setOpen(!open)} className="grid size-4 place-items-center text-(--muted-foreground)">{open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}</button>
        <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="grid size-5 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: platformColor(platform) }}>{platform[0]}</span>
          <span className="truncate font-medium">{platform}</span>
          <span className="truncate text-[11px] text-(--muted-foreground)">{repo.split('/')[1]}</span>
        </button>
        {you > 0 && <span className="rounded-full bg-(--warning) px-1.5 text-[10px] font-semibold text-black">{you}</span>}
      </div>
      {open && live.map((i) => (
        <div key={i.id} className="flex h-7 items-center gap-2 rounded-md pl-8 pr-2 hover:bg-(--row-hover)">
          <StatusGlyph status={i.status} className="size-3" /><span className="min-w-0 flex-1 truncate text-(--muted-foreground)">{i.title}</span>
          <span className="text-[11px] text-(--muted-foreground)">{shortAgo(i.updatedAt, now)}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({ label, value, sub, tone, children }: { label: string; value: ReactNode; sub?: string; tone?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-xl border border-(--border) bg-(--card) px-4 py-3">
      <span className="text-xs text-(--muted-foreground)">{label}</span>
      <span className="text-2xl font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub && <span className="text-[11px] text-(--muted-foreground)">{sub}</span>}
      {children}
    </div>
  );
}

function DeskCard({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  return (
    <article className="grid w-[320px] shrink-0 gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) p-4 shadow-[inset_3px_0_0_var(--warning)]">
      <div className="flex items-center gap-2 text-xs">
        <StatusGlyph status={item.status} /><span className="font-semibold text-(--warning-foreground)">{item.status}</span>
        <span className="text-(--muted-foreground)">· {platformOf(item, data.repos)} {refText(item)} · {shortAgo(item.updatedAt, now)}</span>
      </div>
      <p className="m-0 line-clamp-2 text-[15px] font-medium leading-snug">{item.title}</p>
      <p className="m-0 text-xs text-(--muted-foreground)">{hint(item)}</p>
      <StepTrack status={item.status} />
      <ActionButtons item={item} small />
    </article>
  );
}

function Throughput({ done, now }: { done: Item[]; now: number }) {
  const days = Array.from({ length: 7 }, (_, d) => {
    const start = now - (6 - d) * 86_400_000;
    const key = new Date(start).toDateString();
    return { label: new Date(start).toLocaleDateString(undefined, { weekday: 'narrow' }), n: done.filter((i) => new Date(i.closedAt ?? i.updatedAt).toDateString() === key).length };
  });
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div className="flex h-16 items-end gap-1.5">
      {days.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-sm bg-(--success)" style={{ height: `${Math.max(4, (d.n / max) * 44)}px`, opacity: d.n ? 1 : 0.2 }} title={`${d.n} done`} />
          <span className="text-[10px] text-(--muted-foreground)">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function VariantC() {
  const { data, now } = useBoardStore();
  const [platform, setPlatform] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const all = pages(data);
  const [page, setPage] = useState('general');
  const scoped: BoardData = platform ? { ...data, items: data.items.filter((i) => platformOf(i, data.repos) === platform) } : data;
  const s = boardSections(scoped, now);
  const building = scoped.items.filter((i) => i.status === 'In progress').length;
  const spend = scoped.items.reduce((t, i) => t + (statsOf(i)?.costUsd ?? 0), 0);
  return (
    <div className="proto fixed inset-0 flex bg-(--background) text-(--foreground)">
      <aside className="flex w-[268px] shrink-0 flex-col border-r border-(--border) bg-(--sidebar)">
        <BrandRow><IconButton label="New item"><Plus /></IconButton></BrandRow>
        {settings ? <SettingsNav all={all} current={page} onPick={setPage} onBack={() => setSettings(false)} /> : (
          <>
            <div className="px-2 pb-1"><SidebarButton icon={<ChartColumn />} label="Whole factory" active={!platform} onClick={() => setPlatform(null)} /></div>
            <div className="px-4 pb-1 pt-2 text-[11px] font-medium text-(--muted-foreground)">Repositories</div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-2">
              {data.repos.map((r) => <Repo key={r.repo} platform={r.platform} repo={r.repo} now={now} active={platform === r.platform}
                items={data.items.filter((i) => platformOf(i, data.repos) === r.platform)} onPick={() => setPlatform(r.platform)} />)}
            </nav>
            <div className="border-t border-(--border) p-2">
              <SidebarButton icon={<Settings />} label="Settings" onClick={() => setSettings(true)} />
              <SidebarButton icon={<GitPullRequest />} label="Pull requests" />
              <SidebarButton icon={<ChartColumn />} label="Usage" trailing={<span className="text-[11px] text-(--muted-foreground)">{formatUsd(spend)}</span>} />
            </div>
          </>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {settings ? (
          <>
            <SettingsHeader page={all.find((p) => p.id === page)!} />
            <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-2xl px-8 py-8"><SettingsBody page={all.find((p) => p.id === page)!} /></div></div>
          </>
        ) : (
          <>
            <header className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-(--border) px-4 ${drag}`}>
              <span className="font-medium">{platform ?? 'Whole factory'}</span>
              <span className="text-xs text-(--muted-foreground)">{data.fetchedAt ? `refreshed ${shortAgo(data.fetchedAt, now)}` : ''}</span>
              <span className={`ml-auto flex gap-1.5 ${noDrag}`}><Button small>This week</Button><Button small primary><Plus /> Add item</Button></span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-8 px-8 py-6">
                <div className="grid grid-cols-5 gap-3">
                  <Tile label="Needs you" value={s.needsYou.length} tone={s.needsYou.length ? 'var(--warning-foreground)' : undefined} sub="only you can move these" />
                  <Tile label="Building" value={<>{building}<span className="text-base text-(--muted-foreground)">/2</span></>} sub={building >= 2 ? 'at the in-flight limit' : 'slots free'}>
                    <div className="flex gap-1">{[0, 1].map((n) => <span key={n} className="h-1.5 flex-1 rounded-full" style={{ background: n < building ? 'var(--primary)' : 'var(--soft)' }} />)}</div>
                  </Tile>
                  <Tile label="Queued" value={s.queued.length} sub={`${s.list.length} more in List`} />
                  <Tile label="Shipped" value={s.done.length} sub="last 7 days"><Throughput done={s.done} now={now} /></Tile>
                  <Tile label="Spend" value={formatUsd(spend)} sub="agent cost on open and recent items" />
                </div>
                <section className="grid gap-3">
                  <h2 className="m-0 text-[13px] font-medium">Your desk <span className="text-(--muted-foreground)">{s.needsYou.length}</span></h2>
                  {s.needsYou.length
                    ? <div className="flex gap-3 overflow-x-auto pb-1">{s.needsYou.map((i) => <DeskCard key={i.id} item={i} data={data} now={now} />)}</div>
                    : <p className="m-0 rounded-xl border border-dashed border-(--input) p-6 text-center text-(--muted-foreground)">Desk clear. The line runs without you.</p>}
                </section>
                <section className="grid gap-3">
                  <h2 className="m-0 text-[13px] font-medium">The line</h2>
                  <div className="flex items-stretch overflow-x-auto rounded-xl border border-(--border) bg-(--card)">
                    {STATIONS.map((st, n) => {
                      const here = scoped.items.filter((i) => i.status === st);
                      return (
                        <div key={st} className="relative flex min-w-[150px] flex-1 flex-col gap-2 border-r border-(--border) p-3 last:border-r-0">
                          <div className="flex items-center gap-1.5 text-xs font-medium"><StatusGlyph status={st} />{st}<span className="text-(--muted-foreground)">{here.length}</span></div>
                          <div className="h-0.5 rounded-full" style={{ background: STATUS_COLOR[st], opacity: here.length ? 1 : 0.25 }} />
                          {here.map((i) => (
                            <div key={i.id} className="grid gap-1 rounded-md bg-(--muted) px-2 py-1.5" title={i.title}>
                              <span className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)"><span className="size-1.5 rounded-full" style={{ background: platformColor(platformOf(i, data.repos)) }} />{refText(i)}</span>
                              <span className="line-clamp-2 text-xs leading-snug">{i.title}</span>
                              <SliceBar item={i} />
                            </div>
                          ))}
                          {n < STATIONS.length - 1 && <ArrowRight className="absolute -right-2 top-3.5 z-10 size-4 rounded-full bg-(--card) text-(--muted-foreground)" />}
                        </div>
                      );
                    })}
                  </div>
                  <p className="m-0 text-[11px] text-(--muted-foreground)">{STATUSES.length} steps · List and Done sit off the line</p>
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
