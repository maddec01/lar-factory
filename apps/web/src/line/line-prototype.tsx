// PROTOTYPE for #472 "Redesign items in the line": three looks for the Dossier (collapsed and open) and the In flight
// row, switched by `?variant=a|b|c` (`current` shows today's line). Throwaway: lives on prototype/472-line-redesign.
// Without `?variant=` the line is today's. A: dense strip, B: two-column card, C: stage lanes with attention tabs.
// Round 2: A1/A2 are A with a two-line collapsed Dossier (line 1 title and chips, line 2 a fixed column grid so every
// Dossier's part bar, count, next and repos sit at the same x). A1 puts the chips at the end of line 1, A2 right after
// the title. A1 is the default when `?variant=` is missing; `?variant=current` shows today's line.

import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Ban, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, GitPullRequest, ListChecks, Map as MapIcon, MessagesSquare } from 'lucide-react';
import { kindOf, openBlockers, prLabel, ref, repoKey, repoName } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ItemTitle, SliceBar, repoTone } from '../items/item-parts.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { STATUS_COLOR, ItemStatusGlyph, StatusGlyph } from '../items/status-glyph.tsx';
import { DECISION_KINDS, dossiersOf, inDossiers, isDone, openWaits } from './dossier-parts.ts';
import type { Part } from './dossier-parts.ts';
import { PartStart } from './part-start.tsx';
import { OnYourDesk, YOURS, stageOf, threadText } from './stage-track.tsx';
import { WorkMap } from './work-map.tsx';

const VARIANTS = { a1: 'Two lines, chips at the end', a2: 'Two lines, chips by the title', a: 'Dense strip', b: 'Two-column card', c: 'Stage lanes' } as const;
type Variant = keyof typeof VARIANTS | 'current';
export const variantOf = (): Variant => {
  const v = new URLSearchParams(location.search).get('variant');
  return v === 'current' ? 'current' : v && v in VARIANTS ? (v as Variant) : 'a1';
};

// ---------- shared reading of a dossier ----------

type Slice = Item['slices'][number];
const open = (item: Item) => useItemDialogStore.getState().open(item.id);
const stop = (e: MouseEvent) => e.stopPropagation();

interface Moving {
  parent: Item; parts: Part[]; done: number; count: number;
  needsYou: Part[]; decisions: Part[]; blockedSlices: { part: Part; slice: Slice }[]; waiting: Part[];
  ready: Part[]; active: Part[]; fog: string[];
}

function moving(parent: Item, parts: Part[]): Moving {
  const ahead = parts.filter((p) => !isDone(p.item));
  return {
    parent, parts,
    done: Math.max(parent.subIssues.completed, parts.length - ahead.length),
    count: Math.max(parent.subIssues.total, parts.length),
    needsYou: ahead.filter((p) => YOURS.includes(p.item.status)),
    decisions: ahead.filter((p) => DECISION_KINDS.includes(p.kind)),
    blockedSlices: ahead.flatMap((part) => part.item.slices.filter((s) => s.progress === 'blocked').map((slice) => ({ part, slice }))),
    waiting: ahead.filter((p) => openWaits(p).length > 0 && !YOURS.includes(p.item.status)),
    ready: ahead.filter((p) => (p.item.status === 'Ready' || p.item.status === 'Queued') && !openWaits(p).length),
    active: ahead.filter((p) => ['Shaping', 'In progress', 'Review'].includes(p.item.status)),
    fog: parent.map?.fog ?? [],
  };
}

const waitRefs = (p: Part) => openWaits(p).map((b) => `#${b.number}`).join(', ');

/** Remembers per dossier whether it's open; every dossier starts closed. `&open=all` opens them all, for screenshots. */
function useOpen(id: string): [boolean, () => void] {
  const key = `line-prototype-open:${id}`;
  const [on, set] = useState(() => localStorage.getItem(key) === '1' || new URLSearchParams(location.search).get('open') === 'all');
  return [on, () => { localStorage.setItem(key, on ? '0' : '1'); set(!on); }];
}

function Toggle({ on, onToggle, className = '' }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" aria-expanded={on} aria-label={on ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`grid size-6 shrink-0 place-items-center rounded-md text-(--muted-foreground) hover:bg-(--soft) hover:text-(--foreground) ${className}`}>
      {on ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}

const kindLabel = (parent: Item) => (kindOf(parent) === 'concept' ? 'Concept' : 'Coupled work');
const repos = (m: Moving, data: BoardData) => [...new Set(m.parts.map((p) => repoName(repoKey(p.item), data.repos)))].join(' + ');

/** Every part as a segment in its status colour, done first, so the bar fills left to right. */
function PartsBar({ m, className = 'h-1.5' }: { m: Moving; className?: string }) {
  const order = [...m.parts].sort((a, b) => Number(isDone(b.item)) - Number(isDone(a.item)) || stageOf(b.item.status) - stageOf(a.item.status));
  const unread = m.count - m.parts.length;
  return (
    <ol className="m-0 flex min-w-0 list-none gap-[2px] p-0" title={`${m.done}/${m.count} parts done`}>
      {order.map((p) => (
        <li key={p.item.id} title={`${ref(p.item)} ${p.item.title}: ${p.item.status}`} className={`${className} min-w-[3px] flex-1 rounded-full ${p.item.status === 'In progress' ? 'status-pulse' : ''}`}
          style={{ background: isDone(p.item) ? 'var(--st-done)' : p.item.status === 'Queued' || p.item.status === 'List' ? 'var(--soft)' : STATUS_COLOR[p.item.status] }} />
      ))}
      {Array.from({ length: Math.max(0, unread) }, (_, n) => <li key={`u${n}`} className={`${className} min-w-[3px] flex-1 rounded-full border border-dashed border-(--input)`} />)}
    </ol>
  );
}

/** The one thing to say next: what waits on you, else what can start, else what's moving. */
function nextOf(m: Moving): { tone: 'you' | 'start' | 'moving' | 'none'; part?: Part; text: string } {
  if (m.needsYou[0]) return { tone: 'you', part: m.needsYou[0], text: `${ref(m.needsYou[0].item)} ${m.needsYou[0].item.title}` };
  if (m.ready[0]) return { tone: 'start', part: m.ready[0], text: `${ref(m.ready[0].item)} ${m.ready[0].item.title}` };
  if (m.active[0]) return { tone: 'moving', part: m.active[0], text: `${ref(m.active[0].item)} ${m.active[0].item.title}` };
  return { tone: 'none', text: 'Nothing waits on you' };
}

/** A small count chip: `n` and its word, coloured by `tone`, hidden at zero. */
function Count({ n, word, tone, icon }: { n: number; word: string; tone: 'warning' | 'danger' | 'info' | 'neutral' | 'accent'; icon?: ReactNode }) {
  if (!n) return null;
  return <Badge tone={tone} className="tabular-nums whitespace-nowrap">{icon}{n} {word}</Badge>;
}

function Counts({ m }: { m: Moving }) {
  return <>
    <Count n={m.needsYou.length} word="need you" tone="warning" icon={<StatusGlyph status="Needs you" className="size-3" />} />
    <Count n={m.decisions.length} word={m.decisions.length === 1 ? 'decision' : 'decisions'} tone="accent" icon={<MessagesSquare />} />
    <Count n={m.blockedSlices.length} word="blocked" tone="danger" icon={<Ban />} />
    <Count n={m.fog.length} word="fog" tone="neutral" icon={<CircleHelp />} />
  </>;
}

/** A part's one-line handle: glyph, ref and title, opening its item. */
function PartLink({ part, wrap }: { part: Part; wrap?: boolean }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open(part.item); }} title={`${ref(part.item)} ${part.item.title}`}
      className={`flex min-w-0 items-start gap-1.5 rounded text-left text-[13px] hover:underline ${wrap ? '' : 'truncate'}`}>
      <span className="mt-0.5 inline-flex"><ItemStatusGlyph item={part.item} className="size-3.5" /></span>
      <span className={wrap ? 'line-clamp-2' : 'truncate'}><ItemTitle item={part.item} /></span>
    </button>
  );
}

function Action({ part, data }: { part: Part; data: BoardData }) {
  const { status } = part.item;
  if (YOURS.includes(status)) return <OnYourDesk status={status} />;
  if (status === 'Ready' || status === 'Queued') return <span onClick={stop}><PartStart part={part} data={data} build="Start" /></span>;
  if (['Shaping', 'In progress', 'Review'].includes(status)) return <span onClick={stop}><OpenThread item={part.item} data={data} /></span>;
  return null;
}

type View = 'list' | 'map';
function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
  const one = (v: View, icon: ReactNode, label: string) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onView(v); }} aria-pressed={view === v}
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs ${view === v ? 'bg-(--card) font-medium text-(--foreground) shadow-xs' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{icon}{label}</button>
  );
  return <div className="inline-flex rounded-lg bg-(--muted) p-0.5">{one('map', <MapIcon className="size-3.5" />, 'Work map')}{one('list', <ListChecks className="size-3.5" />, 'Checklist')}</div>;
}

/** The checklist, compact: one line per open part with its slice bar, the done ones folded into a count. */
function Checklist({ m, data, columns }: { m: Moving; data: BoardData; columns?: boolean }) {
  const [showDone, setShowDone] = useState(false);
  const shown = m.parts.filter((p) => showDone || !isDone(p.item));
  const doneN = m.parts.length - m.parts.filter((p) => !isDone(p.item)).length;
  return (
    <div className="grid gap-1">
      <ol className={`m-0 grid list-none gap-x-4 gap-y-0.5 p-0 ${columns ? '@4xl:grid-cols-2' : ''}`}>
        {shown.map((p) => (
          <li key={p.item.id} onClick={() => open(p.item)} className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 hover:bg-(--accent)">
            <span className="flex min-w-0 items-center gap-2">
              <span className={`${repoTone(repoKey(p.item), data.repos)} size-1.5 shrink-0 rounded-full bg-[var(--k,var(--muted-foreground))]`} />
              <PartLink part={p} wrap />
            </span>
            <span className="flex items-center justify-end gap-2 text-[11px] text-(--muted-foreground)">
              {openWaits(p).length > 0 && <span>waits on {waitRefs(p)}</span>}
              {p.item.slices.length > 0 && <span className="tabular-nums">{p.item.slices.filter((s) => s.progress === 'done').length}/{p.item.slices.length}</span>}
              {!openWaits(p).length && <Action part={p} data={data} />}
            </span>
            {p.item.slices.length > 0 && <span className="col-span-2 pl-3.5"><SliceBar item={p.item} /></span>}
          </li>
        ))}
      </ol>
      {doneN > 0 && <button type="button" onClick={() => setShowDone(!showDone)} className="justify-self-start rounded px-2 py-1 text-[11px] text-(--muted-foreground) hover:bg-(--accent)">{showDone ? `Hide ${doneN} done` : `Show ${doneN} done`}</button>}
    </div>
  );
}

function PartsView({ m, data, now, columns }: { m: Moving; data: BoardData; now: number; columns?: boolean }) {
  const [view, setView] = useState<View>('map');
  return (
    <div className="grid gap-3">
      <ViewToggle view={view} onView={setView} />
      {view === 'map' ? <WorkMap parts={m.parts} check={m.parent.map?.check} data={data} now={now} /> : <Checklist m={m} data={data} columns={columns} />}
    </div>
  );
}

const sliceTone = (s: Slice) => (s.progress === 'blocked' ? 'text-(--st-review)' : s.progress === 'active' ? 'text-(--st-now)' : 'text-(--muted-foreground)');

/** What keeps progress moving, as labelled groups; `dense` draws each group as one wrapped line. */
function Attention({ m, data, layout }: { m: Moving; data: BoardData; layout: 'rows' | 'stack' }) {
  const groups: { key: string; label: string; tone: string; n: number; body: ReactNode }[] = [
    { key: 'you', label: 'Needs you', tone: 'text-(--warning-foreground)', n: m.needsYou.length,
      body: m.needsYou.map((p) => <Line key={p.item.id} main={<PartLink part={p} wrap />} side={<Action part={p} data={data} />} />) },
    { key: 'decide', label: 'Open decisions', tone: 'text-(--primary)', n: m.decisions.length,
      body: m.decisions.map((p) => <Line key={p.item.id} main={<PartLink part={p} wrap />} side={<span className="text-[11px] text-(--muted-foreground)">{p.kind} · {p.item.status}</span>} />) },
    { key: 'blocked', label: 'Blocked slices', tone: 'text-(--st-review)', n: m.blockedSlices.length,
      body: <>
        {m.blockedSlices.map(({ part, slice }) => (
          <Line key={slice.number} main={<span className="flex min-w-0 items-start gap-1.5 text-[13px]"><Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" /><span className="line-clamp-2"><span className="text-(--muted-foreground) tabular-nums">#{slice.number}</span> {slice.title}</span></span>}
            side={<span className="text-[11px] text-(--muted-foreground)">slice of {ref(part.item)} · waits on a re-slice</span>} />
        ))}
      </> },
    { key: 'waiting', label: 'Waiting', tone: 'text-(--muted-foreground)', n: m.waiting.length,
      body: m.waiting.map((p) => <Line key={p.item.id} main={<PartLink part={p} wrap />} side={<span className="text-[11px] text-(--muted-foreground)">waits on {waitRefs(p)}</span>} />) },
    { key: 'next', label: 'Ready to start', tone: 'text-(--st-now)', n: m.ready.length,
      body: m.ready.map((p) => <Line key={p.item.id} main={<PartLink part={p} wrap />} side={<Action part={p} data={data} />} />) },
    { key: 'fog', label: 'Fog', tone: 'text-(--st-amber)', n: m.fog.length,
      body: m.fog.map((q) => <Line key={q} main={<span className="flex items-start gap-1.5 text-[13px]"><CircleHelp className="mt-0.5 size-3.5 shrink-0 text-(--st-amber)" /><span>{q}</span></span>} />) },
  ];
  const shown = groups.filter((g) => g.n);
  if (!shown.length) return <p className="m-0 text-[13px] text-(--muted-foreground)">Nothing holds this up.</p>;
  if (layout === 'rows') {
    return (
      <dl className="m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2">
        {shown.map((g) => <div key={g.key} className="contents">
          <dt className={`pt-1 text-[11px] font-medium uppercase tracking-wide ${g.tone}`}>{g.label} <span className="tabular-nums">{g.n}</span></dt>
          <dd className="m-0 grid gap-0.5">{g.body}</dd>
        </div>)}
      </dl>
    );
  }
  return (
    <div className="grid content-start gap-4">
      {shown.map((g) => <section key={g.key} className="grid gap-1">
        <h4 className={`m-0 text-[11px] font-medium uppercase tracking-wide ${g.tone}`}>{g.label} <span className="tabular-nums">{g.n}</span></h4>
        <div className="grid gap-0.5">{g.body}</div>
      </section>)}
    </div>
  );
}

function Line({ main, side }: { main: ReactNode; side?: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md px-1.5 py-1 hover:bg-(--soft)"><span className="min-w-0 flex-1 basis-64">{main}</span>{side && <span className="ml-auto shrink-0">{side}</span>}</div>;
}

/** Next, as a sentence with its button. */
function Next({ m, data, compact }: { m: Moving; data: BoardData; compact?: boolean }) {
  const n = nextOf(m);
  const word = { you: 'Needs you', start: 'Next', moving: 'Moving', none: '' }[n.tone];
  return (
    <span className="flex min-w-0 items-center gap-2 text-[12px]">
      {word && <span className={`shrink-0 font-medium ${n.tone === 'you' ? 'text-(--warning-foreground)' : 'text-(--muted-foreground)'}`}>{word}</span>}
      <span className={`min-w-0 ${compact ? 'truncate' : 'line-clamp-1'}`} title={n.text}>{n.text}</span>
      {n.part && n.tone === 'start' && <span className="shrink-0" onClick={stop}><PartStart part={n.part} data={data} build="Start" /></span>}
    </span>
  );
}

// ---------- In flight: shared filter ----------

function inFlightRows(items: Item[], data: BoardData) {
  const shown = inDossiers(dossiersOf(items, data.items));
  return items.filter((i) => stageOf(i.status) >= 0 && i.status !== 'Done' && !shown.has(i.id)).sort((a, b) => stageOf(b.status) - stageOf(a.status));
}

function FlightSide({ item, data }: { item: Item; data: BoardData }) {
  if (YOURS.includes(item.status)) return <OnYourDesk status={item.status} />;
  if (['Shaping', 'In progress', 'Review'].includes(item.status)) return <span onClick={stop}><OpenThread item={item} data={data} /></span>;
  if (item.status === 'Ready') return <span onClick={stop}><PartStart part={{ item, kind: 'build', waitsOn: item.blockers, thread: undefined }} data={data} build="Start" /></span>;
  return null;
}

const sliceNote = (item: Item) => {
  const b = item.slices.filter((s) => s.progress === 'blocked');
  const a = item.slices.filter((s) => s.progress === 'active');
  return [...b.map((s) => ({ s, word: 'blocked' })), ...a.map((s) => ({ s, word: 'active' }))];
};

function Meta({ item, data, extra }: { item: Item; data: BoardData; extra?: ReactNode }) {
  const blocked = openBlockers(item).length;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-(--muted-foreground)">
      <span className={`${repoTone(repoKey(item), data.repos)} size-1.5 shrink-0 rounded-full bg-[var(--k,var(--muted-foreground))]`} />
      <span>{item.status} · {repoName(repoKey(item), data.repos)} · {threadText(item)}</span>
      {item.linkedPrs[0] && <span className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(item.linkedPrs[0])}</span>}
      {blocked > 0 && <Badge tone="danger">blocked by {blocked}</Badge>}
      {extra}
    </span>
  );
}

function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-(--border) bg-(--card)"><div className="border-b border-(--border) px-3 py-1.5 text-[11px] font-medium text-(--muted-foreground)">{title}</div>{children}</div>;
}

// ---------- Variant A: dense strip ----------

function DossierA({ m, data, now }: { m: Moving; data: BoardData; now: number }) {
  const [on, toggle] = useOpen(m.parent.id);
  return (
    <article className="rounded-xl border border-(--border) bg-(--card)" data-dossier={m.parent.id}>
      <div onClick={() => open(m.parent)} className="grid cursor-pointer grid-cols-[auto_minmax(14rem,1fr)_minmax(10rem,20rem)_auto] items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 hover:bg-(--accent)">
        <Toggle on={on} onToggle={toggle} />
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Badge tone="neutral" className="shrink-0">{kindLabel(m.parent)}</Badge>
            <span className="truncate text-[14px] font-medium" title={m.parent.title}><ItemTitle item={m.parent} /></span>
          </span>
          <span className="pl-0.5"><Next m={m} data={data} compact /></span>
        </span>
        <span className="grid gap-1">
          <PartsBar m={m} />
          <span className="flex justify-between text-[11px] tabular-nums text-(--muted-foreground)"><span>{m.done}/{m.count} parts</span><span className="truncate">{repos(m, data)}</span></span>
        </span>
        <span className="flex flex-wrap justify-end gap-1"><Counts m={m} /></span>
      </div>
      {on && (
        <div className="grid gap-4 border-t border-(--border) px-4 py-3">
          <Attention m={m} data={data} layout="rows" />
          <PartsView m={m} data={data} now={now} columns />
        </div>
      )}
    </article>
  );
}

function FlightA({ item, data }: { item: Item; data: BoardData }) {
  const done = item.slices.filter((s) => s.progress === 'done').length;
  const note = sliceNote(item);
  return (
    <div onClick={() => open(item)} className="grid cursor-pointer grid-cols-[auto_minmax(14rem,1fr)_minmax(10rem,20rem)_9rem] items-center gap-x-3 border-b border-(--border) px-2 py-2 last:border-b-0 hover:bg-(--accent)">
      <span className="grid size-6 place-items-center"><ItemStatusGlyph item={item} /></span>
      <span className="grid min-w-0 gap-0.5">
        <span className="line-clamp-2 text-[13px]" title={item.title}><ItemTitle item={item} /></span>
        <Meta item={item} data={data} />
      </span>
      <span className="grid gap-1">
        {item.slices.length ? <>
          <SliceBar item={item} thick />
          <span className="flex min-w-0 gap-1 text-[11px] text-(--muted-foreground)"><span className="shrink-0 tabular-nums">{done}/{item.slices.length} slices</span>
            {note[0] && <span className="truncate" title={note.map(({ s, word }) => `${word} #${s.number} ${s.title}`).join('\n')}>· <span className={sliceTone(note[0].s)}>{note[0].word}</span> {note[0].s.title}</span>}</span>
        </> : null}
      </span>
      <span className="flex justify-end text-[11px] text-(--muted-foreground)"><FlightSide item={item} data={data} /></span>
    </div>
  );
}

// ---------- Variants A1/A2: A with a two-line collapsed Dossier ----------

/** Line 2's columns, the same fixed widths in every Dossier: part bar, part count, what's next, repos. */
const LINE2 = 'grid-cols-[18rem_5.5rem_minmax(0,1fr)_9rem]';

function DossierA2Lines({ m, data, now, chips }: { m: Moving; data: BoardData; now: number; chips: 'end' | 'title' }) {
  const [on, toggle] = useOpen(m.parent.id);
  return (
    <article className="rounded-xl border border-(--border) bg-(--card)" data-dossier={m.parent.id}>
      <div onClick={() => open(m.parent)} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 rounded-xl px-2 py-2 hover:bg-(--accent)">
        <Toggle on={on} onToggle={toggle} />
        <span className={`flex min-w-0 gap-x-2 gap-y-1 pt-0.5 ${chips === 'end' ? 'items-start justify-between' : 'flex-wrap items-center'}`}>
          <span className={`flex min-w-0 items-start gap-2 ${chips === 'end' ? 'flex-1' : ''}`}>
            <Badge tone="neutral" className="mt-px shrink-0">{kindLabel(m.parent)}</Badge>
            <span className="text-[14px] font-medium" title={m.parent.title}><ItemTitle item={m.parent} /></span>
          </span>
          <span className={`flex gap-1 ${chips === 'end' ? 'shrink-0' : 'flex-wrap'}`}><Counts m={m} /></span>
        </span>
        <span className={`col-start-2 grid ${LINE2} items-center gap-x-4`}>
          <PartsBar m={m} />
          <span className="text-[11px] tabular-nums text-(--muted-foreground)">{m.done}/{m.count} parts</span>
          <Next m={m} data={data} compact />
          <span className="truncate text-right text-[11px] text-(--muted-foreground)" title={repos(m, data)}>{repos(m, data)}</span>
        </span>
      </div>
      {on && (
        <div className="grid gap-4 border-t border-(--border) px-4 py-3">
          <Attention m={m} data={data} layout="rows" />
          <PartsView m={m} data={data} now={now} columns />
        </div>
      )}
    </article>
  );
}

const DossierA1 = (p: { m: Moving; data: BoardData; now: number }) => <DossierA2Lines {...p} chips="end" />;
const DossierA2 = (p: { m: Moving; data: BoardData; now: number }) => <DossierA2Lines {...p} chips="title" />;

// ---------- Variant B: two-column card ----------

function Ring({ done, count }: { done: number; count: number }) {
  const r = 15, c = 2 * Math.PI * r, f = count ? done / count : 0;
  return (
    <span className="relative grid size-10 shrink-0 place-items-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90"><circle cx="18" cy="18" r={r} fill="none" stroke="var(--soft)" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--st-done)" strokeWidth="3" strokeDasharray={`${c * f} ${c}`} strokeLinecap="round" /></svg>
      <span className="text-[10px] font-medium tabular-nums">{Math.round(f * 100)}%</span>
    </span>
  );
}

function DossierB({ m, data, now }: { m: Moving; data: BoardData; now: number }) {
  const [on, toggle] = useOpen(m.parent.id);
  return (
    <article className="overflow-hidden rounded-xl border border-(--border) bg-(--card)" data-dossier={m.parent.id}>
      <div onClick={() => open(m.parent)} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-(--accent)">
        <Ring done={m.done} count={m.count} />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-[11px] text-(--muted-foreground)">{kindLabel(m.parent)} · {m.parent.status} · {m.done}/{m.count} parts · {repos(m, data)}</span>
          <span className="line-clamp-2 text-[15px] font-medium tracking-tight"><ItemTitle item={m.parent} /></span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5"><Counts m={m} /></span>
        </span>
        <span className="hidden max-w-[22rem] min-w-0 shrink @3xl:block"><Next m={m} data={data} /></span>
        <Toggle on={on} onToggle={toggle} />
      </div>
      {on && (
        <div className="grid border-t border-(--border) @4xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 p-3"><PartsView m={m} data={data} now={now} /></div>
          <aside className="border-t border-(--border) bg-[color-mix(in_srgb,var(--muted)_45%,transparent)] p-3 @4xl:border-t-0 @4xl:border-l">
            <h3 className="m-0 mb-3 text-[12px] font-medium">Keeps it moving</h3>
            <Attention m={m} data={data} layout="stack" />
          </aside>
        </div>
      )}
    </article>
  );
}

function FlightB({ item, data }: { item: Item; data: BoardData }) {
  const done = item.slices.filter((s) => s.progress === 'done').length;
  return (
    <div onClick={() => open(item)} className="grid cursor-pointer gap-x-4 gap-y-1.5 border-b border-(--border) px-3 py-2.5 last:border-b-0 hover:bg-(--accent) @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <span className="grid min-w-0 content-center gap-0.5">
        <span className="flex min-w-0 items-start gap-2 text-[13px]"><span className="mt-0.5 inline-flex"><ItemStatusGlyph item={item} /></span><span className="line-clamp-2"><ItemTitle item={item} /></span></span>
        <span className="pl-5.5"><Meta item={item} data={data} /></span>
      </span>
      <span className="grid min-w-0 content-center gap-1">
        {item.slices.length ? <>
          <span className="flex items-center gap-2"><span className="min-w-0 flex-1"><SliceBar item={item} thick /></span><span className="text-[11px] tabular-nums text-(--muted-foreground)">{done}/{item.slices.length}</span></span>
          <span className="grid gap-0.5 text-[11px]">{sliceNote(item).map(({ s, word }) => <span key={s.number} className="truncate" title={s.title}><span className={sliceTone(s)}>{word}</span> <span className="text-(--muted-foreground)">#{s.number}</span> {s.title}</span>)}</span>
        </> : null}
      </span>
      <span className="flex items-center justify-end text-[11px] text-(--muted-foreground)"><FlightSide item={item} data={data} /></span>
    </div>
  );
}

// ---------- Variant C: stage lanes ----------

const LANES: { key: string; label: string; of: (p: Part) => boolean }[] = [
  { key: 'decide', label: 'Decide', of: (p) => DECISION_KINDS.includes(p.kind) },
  { key: 'build', label: 'Build', of: (p) => p.kind === 'build' },
];

/** One small bar per lane, labelled, each with its done count. */
function Lanes({ m }: { m: Moving }) {
  return (
    <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-[11px] text-(--muted-foreground)">
      {LANES.map((l) => {
        const parts = m.parts.filter(l.of);
        if (!parts.length) return null;
        const lane = { ...m, parts, count: parts.length };
        return <span key={l.key} className="contents"><span>{l.label}</span><PartsBar m={lane} className="h-2" /><span className="tabular-nums">{parts.filter((p) => isDone(p.item)).length}/{parts.length}</span></span>;
      })}
    </span>
  );
}

type Tab = 'you' | 'decide' | 'blocked' | 'next' | 'fog';

function DossierC({ m, data, now }: { m: Moving; data: BoardData; now: number }) {
  const [on, toggle] = useOpen(m.parent.id);
  const tabs: { key: Tab; label: string; n: number; tone: string }[] = [
    { key: 'you', label: 'Needs you', n: m.needsYou.length, tone: 'var(--st-amber)' },
    { key: 'decide', label: 'Open decisions', n: m.decisions.length, tone: 'var(--primary)' },
    { key: 'blocked', label: 'Blocked · waiting', n: m.blockedSlices.length + m.waiting.length, tone: 'var(--st-review)' },
    { key: 'next', label: 'Ready to start', n: m.ready.length, tone: 'var(--st-now)' },
    { key: 'fog', label: 'Fog', n: m.fog.length, tone: 'var(--muted-foreground)' },
  ];
  const [tab, setTab] = useState<Tab>(tabs.find((t) => t.n)?.key ?? 'you');
  const only = (k: Tab): Moving => ({ ...m, needsYou: k === 'you' ? m.needsYou : [], decisions: k === 'decide' ? m.decisions : [],
    blockedSlices: k === 'blocked' ? m.blockedSlices : [], waiting: k === 'blocked' ? m.waiting : [], ready: k === 'next' ? m.ready : [], fog: k === 'fog' ? m.fog : [] });
  return (
    <article className="overflow-hidden rounded-xl border border-(--border) bg-(--card)" data-dossier={m.parent.id}>
      <div onClick={() => open(m.parent)} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 px-2 py-2 hover:bg-(--accent) @3xl:grid-cols-[auto_minmax(0,1fr)_minmax(12rem,16rem)_minmax(0,18rem)]">
        <Toggle on={on} onToggle={toggle} />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-[14px] font-medium" title={m.parent.title}><ItemTitle item={m.parent} /></span>
          <span className="truncate text-[11px] text-(--muted-foreground)">{kindLabel(m.parent)} · {m.done}/{m.count} parts · {repos(m, data)}</span>
        </span>
        <span className="col-start-2 @3xl:col-start-auto"><Lanes m={m} /></span>
        <span className="col-start-2 min-w-0 @3xl:col-start-auto"><Next m={m} data={data} compact /></span>
      </div>
      {on && (
        <div className="grid gap-3 border-t border-(--border) p-3">
          <div className="grid grid-cols-5 gap-2" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} disabled={!t.n} onClick={() => setTab(t.key)}
                className={`grid gap-0.5 rounded-lg border px-3 py-2 text-left disabled:opacity-45 ${tab === t.key ? 'border-(--primary) bg-(--accent)' : 'border-(--border) hover:bg-(--soft)'}`}>
                <span className="text-xl font-semibold leading-none tabular-nums" style={{ color: t.n ? t.tone : undefined }}>{t.n}</span>
                <span className="truncate text-[11px] text-(--muted-foreground)">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="min-h-10 rounded-lg bg-[color-mix(in_srgb,var(--muted)_45%,transparent)] p-2"><Attention m={only(tab)} data={data} layout="stack" /></div>
          <PartsView m={m} data={data} now={now} columns />
        </div>
      )}
    </article>
  );
}

const SEG: Record<Slice['progress'], string> = { done: 'bg-[color-mix(in_srgb,var(--st-done)_18%,transparent)] text-(--muted-foreground)', active: 'bg-[color-mix(in_srgb,var(--st-now)_20%,transparent)] font-medium', blocked: 'bg-[color-mix(in_srgb,var(--st-review)_22%,transparent)] text-(--st-review) font-medium', waiting: 'bg-(--soft) text-(--muted-foreground)' };

/** Each slice as a labelled cell, so the slices read without opening the row. */
function SliceStrip({ item }: { item: Item }) {
  return (
    <ol className="m-0 grid min-w-0 list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-[3px] p-0">
      {item.slices.map((s) => (
        <li key={s.number} title={`#${s.number} ${s.title}: ${s.progress}`} className={`min-w-0 truncate rounded-sm px-1.5 py-0.5 text-[10.5px] ${SEG[s.progress]} ${s.progress === 'active' ? 'status-pulse' : ''}`}>
          {s.progress === 'done' ? '✓ ' : s.progress === 'blocked' ? '⊘ ' : ''}{s.title}
        </li>
      ))}
    </ol>
  );
}

function FlightC({ item, data }: { item: Item; data: BoardData }) {
  const done = item.slices.filter((s) => s.progress === 'done').length;
  return (
    <div onClick={() => open(item)} className="grid cursor-pointer grid-cols-[minmax(0,1fr)] gap-1.5 border-b border-(--border) px-3 py-2 last:border-b-0 hover:bg-(--accent)">
      <span className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 inline-flex"><ItemStatusGlyph item={item} /></span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[13px]"><ItemTitle item={item} /></span>
          <Meta item={item} data={data} extra={item.slices.length > 0 && <span className="tabular-nums">· {done}/{item.slices.length} slices</span>} />
        </span>
        <span className="shrink-0 text-[11px] text-(--muted-foreground)"><FlightSide item={item} data={data} /></span>
      </span>
      {item.slices.length > 0 && <span className="min-w-0 pl-5.5"><SliceStrip item={item} /></span>}
    </div>
  );
}

// ---------- the line's prototype sections, and the switcher ----------

const DOSSIER = { a1: DossierA1, a2: DossierA2, a: DossierA, b: DossierB, c: DossierC };
const FLIGHT = { a1: FlightA, a2: FlightA, a: FlightA, b: FlightB, c: FlightC };

export function PrototypeDossiers({ items, variant }: { items: Item[]; variant: keyof typeof VARIANTS }) {
  const { data, now } = useBoardStore();
  const D = DOSSIER[variant];
  return <div className="grid gap-2">{dossiersOf(items, data.items).map(({ parent, parts }) => <D key={parent.id} m={moving(parent, parts)} data={data} now={now} />)}</div>;
}

export function PrototypeInFlight({ items, variant }: { items: Item[]; variant: keyof typeof VARIANTS }) {
  const { data } = useBoardStore();
  const rows = inFlightRows(items, data);
  const F = FLIGHT[variant];
  return <Card title={`Everything else in flight · ${rows.length}`}>{rows.map((i) => <F key={i.id} item={i} data={data} />)}</Card>;
}

const KEYS: Variant[] = ['a1', 'a2', 'a', 'b', 'c', 'current'];
const nameOf = (v: Variant) => (v === 'current' ? 'Today' : VARIANTS[v]);

/** The prototype's floating bar: arrows and ←/→ cycle the variants through `?variant=`. */
export function PrototypeSwitcher({ variant, onVariant }: { variant: Variant; onVariant: (v: Variant) => void }) {
  const go = (step: number) => {
    const next = KEYS[(KEYS.indexOf(variant) + step + KEYS.length) % KEYS.length]!;
    const url = new URL(location.href);
    url.searchParams.set('variant', next);
    history.replaceState(null, '', url);
    onVariant(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable], [role="dialog"]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900 px-1.5 py-1 text-xs text-white shadow-lg ring-1 ring-white/10">
      <button type="button" aria-label="Previous variant" onClick={() => go(-1)} className="grid size-6 place-items-center rounded-full hover:bg-white/15"><ChevronLeft className="size-4" /></button>
      <span className="min-w-40 text-center font-medium">{variant.toUpperCase()} · {nameOf(variant)}</span>
      <button type="button" aria-label="Next variant" onClick={() => go(1)} className="grid size-6 place-items-center rounded-full hover:bg-white/15"><ChevronRight className="size-4" /></button>
    </div>
  );
}

