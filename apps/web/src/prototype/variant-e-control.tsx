// PROTOTYPE, throwaway. Variant E, "Control room": C's overview with A's detail. The window stays a
// dashboard (KPI tiles, your desk, the line as stations, repos in the sidebar), and clicking any item, in
// the sidebar, on the desk or on the line, opens A's full detail in an inspector on the right without
// leaving the overview. The picked item lights up everywhere it appears. Esc closes the inspector.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ChartColumn, ChevronDown, ChevronRight, GitPullRequest, Plus, Search, Settings, X } from 'lucide-react';
import { boardSections, formatUsd, platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { BrandRow, Button, IconButton, Kbd, PlatformTag, SidebarButton, StatusGlyph, STATUS_COLOR, drag, noDrag, platformColor } from './chrome.tsx';
import { ActionButtons, PrList, SliceBar, SliceList, StatsGrid, StepTrack, hint, refText, statsOf } from './item-bits.tsx';
import { SettingsBody, SettingsHeader, SettingsNav, pages } from './proto-settings.tsx';

const STATIONS: Status[] = ['Queued', 'Shaping', 'Ready', 'In progress', 'Review', 'Verify', 'Ready to merge'];
const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];
const picked = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : '');

type Pick = { id: string | null; set: (id: string) => void };

function Repo({ platform, repo, items, now, scoped, onScope, pick }: { platform: string; repo: string; items: Item[]; now: number; scoped: boolean; onScope: () => void; pick: Pick }) {
  const [open, setOpen] = useState(true);
  const live = items.filter((i) => i.status !== 'List' && i.status !== 'Done');
  const you = items.filter((i) => YOURS.includes(i.status)).length;
  return (
    <div className="mb-1">
      <div className={`flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-(--row-hover) ${scoped ? 'bg-(--row-active)' : ''}`}>
        <button type="button" onClick={() => setOpen(!open)} className="grid size-4 place-items-center text-(--muted-foreground)">{open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}</button>
        <button type="button" onClick={onScope} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="grid size-5 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: platformColor(platform) }}>{platform[0]}</span>
          <span className="truncate font-medium">{platform}</span>
          <span className="truncate text-[11px] text-(--muted-foreground)">{repo.split('/')[1]}</span>
        </button>
        {you > 0 && <span className="rounded-full bg-(--warning) px-1.5 text-[10px] font-semibold text-black">{you}</span>}
      </div>
      {open && (
        <div className="flex flex-col gap-px">
          {live.map((i) => (
            <button key={i.id} type="button" onClick={() => pick.set(i.id)}
              className={`flex h-7 w-full items-center gap-2 rounded-md pl-8 pr-2 text-left hover:bg-(--row-hover) ${pick.id === i.id ? 'bg-(--row-active) font-medium' : ''}`}>
              <StatusGlyph status={i.status} className="size-3" />
              <span className={`min-w-0 flex-1 truncate ${pick.id === i.id ? '' : 'text-(--muted-foreground)'}`}>{i.title}</span>
              <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-(--muted-foreground)">{shortAgo(i.updatedAt, now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone, children }: { label: string; value: ReactNode; sub?: string; tone?: string; children?: ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-xl border border-(--border) bg-(--card) px-4 py-3">
      <span className="text-xs text-(--muted-foreground)">{label}</span>
      <span className="text-2xl font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub && <span className="text-[11px] text-(--muted-foreground)">{sub}</span>}
      {children}
    </div>
  );
}

function Throughput({ done, now }: { done: Item[]; now: number }) {
  const days = Array.from({ length: 7 }, (_, d) => {
    const key = new Date(now - (6 - d) * 86_400_000).toDateString();
    return done.filter((i) => new Date(i.closedAt ?? i.updatedAt).toDateString() === key).length;
  });
  const max = Math.max(1, ...days);
  return (
    <div className="flex h-6 items-end gap-1">
      {days.map((n, i) => <div key={i} className="flex-1 rounded-sm bg-(--success)" style={{ height: `${Math.max(3, (n / max) * 24)}px`, opacity: n ? 1 : 0.2 }} title={`${n} done`} />)}
    </div>
  );
}

function DeskCard({ item, data, now, pick }: { item: Item; data: BoardData; now: number; pick: Pick }) {
  return (
    <button type="button" onClick={() => pick.set(item.id)}
      className={`grid w-[280px] shrink-0 gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) p-3.5 text-left shadow-[inset_3px_0_0_var(--warning)] hover:bg-(--accent) ${picked(pick.id === item.id)}`}>
      <span className="flex items-center gap-2 text-xs">
        <StatusGlyph status={item.status} /><span className="font-semibold text-(--warning-foreground)">{item.status}</span>
        <span className="truncate text-(--muted-foreground)">· {platformOf(item, data.repos)} {refText(item)} · {shortAgo(item.updatedAt, now)}</span>
      </span>
      <span className="line-clamp-2 font-medium leading-snug">{item.title}</span>
      <span className="text-xs text-(--muted-foreground)">{hint(item)}</span>
      <StepTrack status={item.status} />
    </button>
  );
}

function Line({ items, data, pick }: { items: Item[]; data: BoardData; pick: Pick }) {
  return (
    <div className="flex items-stretch overflow-x-auto rounded-xl border border-(--border) bg-(--card)">
      {STATIONS.map((st, n) => {
        const here = items.filter((i) => i.status === st);
        return (
          <div key={st} className="relative flex min-w-[140px] flex-1 flex-col gap-2 border-r border-(--border) p-3 last:border-r-0">
            <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium"><StatusGlyph status={st} />{st}<span className="text-(--muted-foreground)">{here.length}</span></div>
            <div className="h-0.5 rounded-full" style={{ background: STATUS_COLOR[st], opacity: here.length ? 1 : 0.25 }} />
            {here.map((i) => (
              <button key={i.id} type="button" onClick={() => pick.set(i.id)} title={i.title}
                className={`grid gap-1 rounded-md bg-(--muted) px-2 py-1.5 text-left hover:bg-(--accent) ${picked(pick.id === i.id)}`}>
                <span className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)"><span className="size-1.5 rounded-full" style={{ background: platformColor(platformOf(i, data.repos)) }} />{refText(i)}</span>
                <span className="line-clamp-2 text-xs leading-snug">{i.title}</span>
                <SliceBar item={i} />
              </button>
            ))}
            {n < STATIONS.length - 1 && <ArrowRight className="absolute -right-2 top-3.5 z-10 size-4 rounded-full bg-(--card) text-(--muted-foreground)" />}
          </div>
        );
      })}
    </div>
  );
}

/** A's item detail, narrowed to an inspector: the same sections, the actions pinned at its foot. */
function Inspector({ item, data, now, onClose }: { item: Item; data: BoardData; now: number; onClose: () => void }) {
  const h = hint(item);
  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-(--border) bg-(--background)">
      <header className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-(--border) px-4 ${drag}`}>
        <PlatformTag platform={platformOf(item, data.repos)} />
        <span className="text-(--muted-foreground) tabular-nums">{refText(item)}</span>
        <span className={`ml-auto ${noDrag}`}><IconButton label="Close (Esc)" onClick={onClose}><X /></IconButton></span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-5 px-5 py-5">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-(--muted-foreground)">
              <StatusGlyph status={item.status} /> <span className="font-medium text-(--foreground)">{item.status}</span> · updated {shortAgo(item.updatedAt, now)}
              {item.blockedBy > 0 && <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)">blocked by {item.blockedBy}</span>}
            </div>
            <h1 className="m-0 text-lg font-semibold leading-snug tracking-tight">{item.title}</h1>
            {item.parent && <p className="m-0 text-(--muted-foreground)">Part of <a href={item.parent.url} className="underline">#{item.parent.number} {item.parent.title}</a></p>}
          </div>
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
        </div>
      </div>
      <footer className="flex shrink-0 justify-end border-t border-(--border) px-4 py-3"><ActionButtons item={item} /></footer>
    </aside>
  );
}

export function VariantE() {
  const { data, now } = useBoardStore();
  const [platform, setPlatform] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const all = pages(data);
  const [page, setPage] = useState('general');
  const [id, setId] = useState<string | null>(() => boardSections(data, now).needsYou[0]?.id ?? null);
  const pick: Pick = { id, set: (next) => setId(next === id ? null : next) };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const scoped: BoardData = platform ? { ...data, items: data.items.filter((i) => platformOf(i, data.repos) === platform) } : data;
  const s = boardSections(scoped, now);
  const building = scoped.items.filter((i) => i.status === 'In progress').length;
  const spend = scoped.items.reduce((t, i) => t + (statsOf(i)?.costUsd ?? 0), 0);
  const prs = scoped.items.reduce((n, i) => n + i.linkedPrs.length, 0);
  const item = data.items.find((i) => i.id === id);
  const current = all.find((p) => p.id === page)!;
  return (
    <div className="proto fixed inset-0 flex bg-(--background) text-(--foreground)">
      <aside className="flex w-[268px] shrink-0 flex-col border-r border-(--border) bg-(--sidebar)">
        <BrandRow><IconButton label="New item"><Plus /></IconButton></BrandRow>
        {settings ? <SettingsNav all={all} current={page} onPick={setPage} onBack={() => setSettings(false)} /> : (
          <>
            <div className="grid gap-1 px-2 pb-2">
              <SidebarButton icon={<Search />} label="Search items" trailing={<Kbd>⌘K</Kbd>} />
              <SidebarButton icon={<ChartColumn />} label="Whole factory" active={!platform} onClick={() => setPlatform(null)} />
            </div>
            <div className="px-4 pb-1 pt-1 text-[11px] font-medium text-(--muted-foreground)">Repositories</div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-2">
              {data.repos.map((r) => <Repo key={r.repo} platform={r.platform} repo={r.repo} now={now} pick={pick} scoped={platform === r.platform}
                items={data.items.filter((i) => platformOf(i, data.repos) === r.platform)} onScope={() => setPlatform(platform === r.platform ? null : r.platform)} />)}
            </nav>
            <div className="border-t border-(--border) p-2">
              <SidebarButton icon={<Settings />} label="Settings" onClick={() => setSettings(true)} />
              <SidebarButton icon={<GitPullRequest />} label="Pull requests" trailing={<span className="text-[11px] text-(--muted-foreground)">{prs}</span>} />
              <SidebarButton icon={<ChartColumn />} label="Usage" trailing={<span className="text-[11px] text-(--muted-foreground)">{formatUsd(spend)}</span>} />
            </div>
          </>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {settings ? (
          <>
            <SettingsHeader page={current} />
            <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-2xl px-8 py-8"><SettingsBody page={current} /></div></div>
          </>
        ) : (
          <>
            <header className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-(--border) px-4 ${drag}`}>
              <span className="font-medium">{platform ?? 'Whole factory'}</span>
              <span className="text-xs text-(--muted-foreground)">{data.fetchedAt ? `refreshed ${shortAgo(data.fetchedAt, now)}` : ''}</span>
              <span className={`ml-auto flex gap-1.5 ${noDrag}`}><Button small>This week</Button><Button small primary><Plus /> Add item</Button></span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-7 px-6 py-5">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
                  <Tile label="Needs you" value={s.needsYou.length} tone={s.needsYou.length ? 'var(--warning-foreground)' : undefined} sub="only you can move these" />
                  <Tile label="Building" value={<>{building}<span className="text-base text-(--muted-foreground)">/2</span></>} sub={building >= 2 ? 'at the in-flight limit' : 'slots free'}>
                    <div className="flex gap-1">{[0, 1].map((n) => <span key={n} className="h-1.5 flex-1 rounded-full" style={{ background: n < building ? 'var(--primary)' : 'var(--soft)' }} />)}</div>
                  </Tile>
                  <Tile label="Queued" value={s.queued.length} sub={`${s.list.length} more in List`} />
                  <Tile label="Shipped" value={s.done.length} sub="last 7 days"><Throughput done={s.done} now={now} /></Tile>
                  <Tile label="Spend" value={formatUsd(spend)} sub="agent cost, open and recent" />
                </div>
                <section className="grid gap-3">
                  <h2 className="m-0 text-[13px] font-medium">Your desk <span className="text-(--muted-foreground)">{s.needsYou.length}</span></h2>
                  {s.needsYou.length
                    ? <div className="flex gap-3 overflow-x-auto p-1">{s.needsYou.map((i) => <DeskCard key={i.id} item={i} data={data} now={now} pick={pick} />)}</div>
                    : <p className="m-0 rounded-xl border border-dashed border-(--input) p-6 text-center text-(--muted-foreground)">Desk clear. The line runs without you.</p>}
                </section>
                <section className="grid gap-3">
                  <h2 className="m-0 text-[13px] font-medium">The line</h2>
                  <Line items={scoped.items} data={data} pick={pick} />
                </section>
              </div>
            </div>
          </>
        )}
      </main>
      {!settings && item && <Inspector item={item} data={data} now={now} onClose={() => setId(null)} />}
    </div>
  );
}
