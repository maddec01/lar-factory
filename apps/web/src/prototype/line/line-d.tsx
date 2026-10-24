// PROTOTYPE, throwaway. Line variant D, "Table + dossiers + queue": C's progress table with B's map folded into each
// dossier. The queue sits on top as its own list, started by hand (auto-start comes later, against the build
// slots). Concepts and coupled work follow as dossiers: a checklist of their parts in order, or the map of what waits
// on what, with their done parts folded away. Then everything else in flight on the same aligned stage track.
// Every row carries its agent time, tokens and cost, and every build its slices. Items waiting on you show where
// they are but take no action here: you act on them from the desk.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, CircleHelp, FlaskConical, GitPullRequest, GripVertical, ListChecks, Map as MapIcon } from 'lucide-react';
import { duration, formatTokens, formatUsd, platformOf, plural, prLabel, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, ItemStats, Status } from '@mux-factory/shared';
import { Button as UiButton } from '@mux-factory/ui/button';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { PlatformTag, STATUS_COLOR, StatusGlyph, platformColor } from '../chrome.tsx';
import type { Pick } from '../list-sidebar.tsx';
import { ItemTitle, SliceBar, SliceList, refText, statsOf } from '../item-bits.tsx';
import { WorkMap, workOf } from './line-b-map.tsx';
import { CONCEPTS } from './line-data.ts';
import type { LineProps } from './line-data.ts';

export const NAME = 'Table + dossiers + queue';

const BUILD_LIMIT = 2;
const STAGES: { name: string; short: string; statuses: Status[] }[] = [
  { name: 'Refining', short: 'Refine', statuses: ['Shaping', 'Needs you'] },
  { name: 'Ready', short: 'Ready', statuses: ['Ready'] },
  { name: 'Building', short: 'Build', statuses: ['In progress'] },
  { name: 'Review', short: 'Review', statuses: ['Review'] },
  { name: 'Verify', short: 'Verify', statuses: ['Verify', 'Ready to merge'] },
  { name: 'Done', short: 'Done', statuses: ['Done'] },
];
const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];
const stageOf = (s: Status) => STAGES.findIndex((st) => st.statuses.includes(s));
/** One grid for every row, in the table and in each dossier, so the stage and agent columns line up down the page. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_13rem_6rem_8rem] items-center gap-x-4 px-3 @3xl:grid-cols-[minmax(0,1fr)_18rem_7rem_11rem]';
const picked = (on: boolean) => (on ? 'bg-(--accent) ring-2 ring-inset ring-(--primary)' : '');
const PAST = 'color-mix(in srgb, var(--foreground) 28%, transparent)';

/** PROTOTYPE mock: agent figures for in-flight items the sample has none for, so the column shows what it would. */
const MOCK_STATS: Record<number, ItemStats> = {
  150: { agentMs: 19_800_000, wallMs: 11_400_000, tokens: 31_400_000, costUsd: 46.9 },
  130: { agentMs: 1_140_000, wallMs: 720_000, tokens: 1_204_000, costUsd: 1.92 },
  201: { agentMs: 1_680_000, wallMs: 960_000, tokens: 1_870_000, costUsd: 2.71 },
  202: { agentMs: 2_460_000, wallMs: 1_500_000, tokens: 2_950_000, costUsd: 4.35 },
  203: { agentMs: 1_320_000, wallMs: 900_000, tokens: 1_410_000, costUsd: 2.05 },
};
const stats = (i: Item): ItemStats | null => statsOf(i) ?? (i.number !== null ? MOCK_STATS[i.number] ?? null : null);
const sum = (items: Item[]) => items.reduce<ItemStats | null>((t, i) => {
  const s = stats(i);
  return s ? { agentMs: (t?.agentMs ?? 0) + s.agentMs, tokens: (t?.tokens ?? 0) + s.tokens, costUsd: (t?.costUsd ?? 0) + (s.costUsd ?? 0) } : t;
}, null);

type Concept = (typeof CONCEPTS)[number];
type Kind = Concept['tasks'][number]['kind'];
type Thread = Concept['threads'][number];
const KINDS: Kind[] = ['research', 'grill', 'prototype', 'build', 'end-to-end'];
const THREAD_GLYPH: Record<Thread['state'], Status> = { running: 'In progress', 'needs you': 'Needs you', done: 'Done', 'not started': 'Queued' };
const E2E_GLYPH: Record<Concept['endToEnd']['state'], Status> = { waiting: 'Queued', running: 'In progress', passed: 'Done', failed: 'Needs you' };

interface Part { issue: number; kind: Kind; repo: string; waitsOn: number[]; item: Item | undefined; thread: Thread | undefined }

const kindOf = (i: Item): Kind => (KINDS.find((k) => i.labels.includes(`decision: ${k}`)) ?? 'build');
const childOf = (c: Item, p: Item) => c.parent?.number === p.number && c.parent.repo === p.repo;
const findIn = (data: BoardData, n: number, repo?: string) => data.items.find((i) => i.number === n && (!repo || i.repo === repo)) ?? data.items.find((i) => i.number === n);
const isDone = (p: Part) => p.item?.status === 'Done';

/** A parent's parts in the order they run: decisions, then builds; from the mock when it has one, else its sub-issues. */
function partsOf(parent: Item, data: BoardData): Part[] {
  const concept = parent.number !== null ? CONCEPTS[parent.number] : undefined;
  const tasks = concept?.tasks ?? [];
  const extra = data.items.filter((c) => childOf(c, parent) && !tasks.some((t) => t.issue === c.number))
    .map((c) => ({ issue: c.number!, kind: kindOf(c), repo: c.repo ?? '', waitsOn: [] }));
  return [...tasks, ...extra]
    .map((t) => ({ ...t, item: findIn(data, t.issue, t.repo), thread: concept?.threads.find((th) => th.issue === t.issue) }))
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

/** What still holds a part back: the parts it waits on that aren't done, while it hasn't started building. */
const openWaits = (p: Part, data: BoardData) =>
  p.item && stageOf(p.item.status) > 1 ? [] : p.waitsOn.filter((n) => findIn(data, n)?.status !== 'Done');

/** The one thing a status asks next, as a mock button. Items waiting on you get none: the desk is where you act. */
function nextAction(status: Status, waiting: boolean): { label: string; primary?: boolean; disabled?: boolean } | null {
  switch (status) {
    case 'Ready': return { label: 'Start build', primary: !waiting, disabled: waiting };
    case 'Shaping': case 'In progress': case 'Review': return { label: 'Open thread' };
    default: return null;
  }
}

/** A mock button that doesn't open the item underneath it. */
function Act({ label, primary, disabled }: { label: ReactNode; primary?: boolean; disabled?: boolean }) {
  return (
    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <UiButton variant={primary ? 'default' : 'outline'} size="xs" disabled={disabled}>{label}</UiButton>
    </span>
  );
}

const THREAD_TEXT: Partial<Record<Status, string>> = {
  Shaping: 'shaping thread running', Ready: 'build starts on Start', 'In progress': 'build thread running', Review: 'reviewers running',
};

/** The side cell for an item: its thread, its action, or where to act on it when it waits on you. */
function Side({ item, waiting }: { item: Item; waiting?: boolean }) {
  if (YOURS.includes(item.status)) return <span className="inline-flex items-center gap-1 text-(--warning-foreground)"><StatusGlyph status={item.status} className="size-3" />on your desk</span>;
  const next = nextAction(item.status, !!waiting);
  return <><span className="min-w-0 truncate">{waiting && item.status === 'Ready' ? `blocked by ${item.blockedBy}` : THREAD_TEXT[item.status]}</span>{next && <Act {...next} />}</>;
}

/** Agent time over tokens and cost; a dash before any thread has worked on it. */
function AgentCell({ s, frozen }: { s: ItemStats | null; frozen?: boolean }) {
  if (!s) return <span className="text-right text-[11px] text-(--muted-foreground)">–</span>;
  return (
    <span className="grid text-right text-[11px] leading-tight tabular-nums text-(--muted-foreground)" title={frozen ? 'As it stood at merge' : 'Agent time · tokens · cost'}>
      <span className="font-medium text-(--foreground)">{duration(s.agentMs)}</span>
      <span>{formatTokens(s.tokens)} · {s.costUsd !== undefined ? formatUsd(s.costUsd) : '–'}</span>
    </span>
  );
}

/** Six stage cells: the stages behind filled, the current one coloured up to its glyph, the rest faint. */
function Track({ status, waiting }: { status: Status; waiting?: boolean }) {
  const at = stageOf(status);
  return (
    <ol className="m-0 grid list-none grid-cols-6 gap-px p-0" title={`${status}${waiting ? ', waiting' : ''}`}>
      {STAGES.map((st, n) => (
        <li key={st.name} className="relative flex h-5 items-center justify-center">
          <span className={`absolute inset-x-0 h-1.5 ${n === 0 ? 'rounded-l-full' : ''} ${n === STAGES.length - 1 ? 'rounded-r-full' : ''}`}
            style={{ background: n < at ? PAST : 'var(--soft)' }} />
          {n === at && (
            <>
              <span className={`absolute left-0 right-1/2 h-1.5 ${n === 0 ? 'rounded-l-full' : ''}`} style={{ background: STATUS_COLOR[status], opacity: waiting ? 0.35 : 1 }} />
              <span className={`relative grid size-5 place-items-center rounded-full bg-(--card) ${waiting ? 'border border-dashed border-(--muted-foreground)' : ''}`}><StatusGlyph status={status} /></span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function StageHeader({ label, side }: { label: ReactNode; side: ReactNode }) {
  return (
    <div className={`${GRID} border-b border-(--border) py-1.5 text-[11px] text-(--muted-foreground)`}>
      <span className="truncate font-medium">{label}</span>
      <ol className="m-0 grid list-none grid-cols-6 gap-px p-0 text-center">
        {STAGES.map((st) => <li key={st.name} title={st.statuses.join(', ')} className="truncate"><span className="@3xl:hidden">{st.short}</span><span className="hidden @3xl:inline">{st.name}</span></li>)}
      </ol>
      <span className="text-right">Agent</span>
      <span className="truncate text-right">{side}</span>
    </div>
  );
}

/** A build's slices at a glance: the bar across the title column, the count, and the slices that are moving or stuck. */
function SliceSummary({ item, open, onToggle }: { item: Item; open: boolean; onToggle: () => void }) {
  const done = item.slices.filter((s) => s.progress === 'done').length;
  const active = item.slices.filter((s) => s.progress === 'active');
  const blocked = item.slices.filter((s) => s.progress === 'blocked');
  const named = [...blocked.map((s) => ({ s, tone: 'text-(--st-review)', word: 'blocked' })), ...active.map((s) => ({ s, tone: 'text-(--st-now)', word: 'active' }))];
  return (
    <span className="grid gap-1">
      <SliceBar item={item} />
      <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className="flex min-w-0 items-center gap-1 text-left text-[11px] text-(--muted-foreground) hover:text-(--foreground)">
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className="shrink-0 font-medium tabular-nums text-(--foreground)">{done}/{item.slices.length} slices</span>
        {named.length > 0 && <span className="min-w-0 truncate">· {named.map(({ s, tone, word }, n) => <span key={s.number}>{n > 0 && ', '}<span className={tone}>{word}</span> #{s.number} {s.title}</span>)}</span>}
      </button>
    </span>
  );
}

/** One piece of work on the track; the whole row opens it, and a build's slices unfold under it. */
function Row({ item, data, now, pick, side, waiting, nested }: { item: Item; data: BoardData; now: number; pick: Pick; side: ReactNode; waiting?: boolean; nested?: boolean }) {
  const [slices, setSlices] = useState(false);
  return (
    <div className="border-b border-(--border) last:border-b-0">
      <div onClick={() => pick.set(item.id)} className={`${GRID} cursor-pointer py-2 hover:bg-(--accent) ${picked(pick.id === item.id)}`}>
        <span title={`${refText(item)} ${item.title}`} className="flex min-w-0 items-start gap-2 text-left">
          {nested && <span className="mb-auto ml-1 h-3 w-2.5 shrink-0 rounded-bl border-b border-l border-(--input)" />}
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: platformColor(platformOf(item, data.repos)) }} />
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="truncate text-[13px]"><ItemTitle item={item} /></span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--muted-foreground)">
              <span className="truncate">{item.status} · {platformOf(item, data.repos)} · {shortAgo(item.updatedAt, now)}</span>
              {item.blockedBy > 0 && <span className="shrink-0 rounded bg-(--error-surface) px-1 text-(--error-foreground)">blocked by {item.blockedBy}</span>}
            </span>
            {item.slices.length > 0 && <SliceSummary item={item} open={slices} onToggle={() => setSlices(!slices)} />}
          </span>
        </span>
        <Track status={item.status} waiting={waiting} />
        <AgentCell s={stats(item)} frozen={statsOf(item)?.frozen} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-[11px] text-(--muted-foreground)">{side}</div>
      </div>
      {slices && <div className={`pb-2 ${nested ? 'pl-12' : 'pl-7'} pr-3`}><SliceList item={item} /></div>}
    </div>
  );
}

/** Text with its `#n` references as buttons that open the item. */
function Refs({ text, find, pick }: { text: string; find: (n: number) => Item | undefined; pick: Pick }) {
  return text.split(/(#\d+)/).map((bit, n) => {
    const item = /^#\d+$/.test(bit) ? find(Number(bit.slice(1))) : undefined;
    return item
      ? <button key={n} type="button" onClick={() => pick.set(item.id)} title={item.title} className="rounded px-0.5 font-medium tabular-nums text-(--primary) hover:bg-(--accent)">{bit}</button>
      : bit;
  });
}

function WaitChips({ waitsOn, data, pick }: { waitsOn: number[]; data: BoardData; pick: Pick }) {
  return waitsOn.map((n) => {
    const it = findIn(data, n);
    const done = it?.status === 'Done';
    return (
      <button key={n} type="button" disabled={!it} onClick={(e) => { e.stopPropagation(); if (it) pick.set(it.id); }} title={it ? `${it.title}: ${it.status}` : undefined}
        className={`inline-flex items-center gap-1 rounded border px-1 tabular-nums hover:bg-(--accent) ${done ? 'border-(--border) text-(--muted-foreground)' : 'border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] text-(--warning-foreground)'}`}>
        {done ? <Check className="size-3 text-(--st-done)" /> : it && <StatusGlyph status={it.status} className="size-3" />}#{n}
      </button>
    );
  });
}

function ThreadLine({ thread, waits }: { thread: Thread | undefined; waits: number[] }) {
  if (!thread) return waits.length ? <span>Thread starts when {waits.map((n) => `#${n}`).join(', ')} {waits.length > 1 ? 'are' : 'is'} done</span> : null;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={thread.title}>
      <StatusGlyph status={THREAD_GLYPH[thread.state]} className="size-3" />
      <span className="truncate">T3 · {thread.title}</span>
      <span className="shrink-0">· {thread.state === 'not started' && waits.length ? `starts after ${waits.map((n) => `#${n}`).join(', ')}` : thread.state}</span>
    </span>
  );
}

/** One step of the checklist: the part, what it waits on, its figures, its thread and its next action. */
function Step({ part, data, pick }: { part: Part; data: BoardData; pick: Pick }) {
  const { item } = part;
  const waits = openWaits(part, data);
  const next = item && !YOURS.includes(item.status) ? nextAction(item.status, waits.length > 0) : null;
  const s = item && stats(item);
  return (
    <li onClick={() => item && pick.set(item.id)} className={`grid cursor-pointer gap-1 rounded-md px-2 py-1.5 hover:bg-(--accent) ${picked(!!item && pick.id === item.id)}`}>
      <span className="flex min-w-0 items-center gap-2">
        <StatusGlyph status={item?.status ?? 'Queued'} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{item ? <ItemTitle item={item} /> : `#${part.issue}`}</span>
        <span className="shrink-0 rounded border border-(--border) px-1 text-[10px] text-(--muted-foreground)">{part.kind}</span>
        {next && <Act {...next} />}
        {item && YOURS.includes(item.status) && <span className="shrink-0 text-[11px] text-(--warning-foreground)">on your desk</span>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5.5 text-[11px] text-(--muted-foreground)">
        <span>{item?.status ?? 'not on the board'}</span>
        {s && <span className="tabular-nums">{duration(s.agentMs)} · {formatTokens(s.tokens)} · {s.costUsd !== undefined ? formatUsd(s.costUsd) : '–'}</span>}
        {item && item.slices.length > 0 && <span className="tabular-nums">{item.slices.filter((x) => x.progress === 'done').length}/{item.slices.length} slices</span>}
        {part.waitsOn.length > 0 && <span className="inline-flex flex-wrap items-center gap-1">{item && stageOf(item.status) > 1 ? 'after' : 'waits on'} <WaitChips waitsOn={part.waitsOn} data={data} pick={pick} /></span>}
        {item?.linkedPrs.map((pr) => <span key={pr.number} className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(pr)}</span>)}
      </span>
      {item && item.slices.length > 0 && <span className="pl-5.5"><SliceBar item={item} /></span>}
      <span className="min-w-0 pl-5.5 text-[11px] text-(--muted-foreground)"><ThreadLine thread={part.thread} waits={waits} /></span>
    </li>
  );
}

/** The parts of one phase, the done ones folded into a single line until you open it. */
function Phase({ title, hint, parts, data, pick }: { title: ReactNode; hint?: ReactNode; parts: Part[]; data: BoardData; pick: Pick }) {
  const [showDone, setShowDone] = useState(false);
  const done = parts.filter(isDone);
  const open = parts.filter((p) => !isDone(p));
  return (
    <section className="grid gap-1">
      <h4 className="m-0 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">{title}{hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}</h4>
      <ol className="m-0 grid list-none gap-0.5 p-0">
        {open.map((p) => <Step key={p.issue} part={p} data={data} pick={pick} />)}
        {done.length > 0 && (
          <li>
            <button type="button" onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] text-(--muted-foreground) hover:bg-(--accent)">
              <Check className="size-3.5 text-(--st-done)" /><span className="flex-1">{done.length} done</span>{showDone ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          </li>
        )}
        {showDone && done.map((p) => <Step key={p.issue} part={p} data={data} pick={pick} />)}
      </ol>
    </section>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">{children}</h3>;
}

/** Checklist or map: one dossier's way of drawing its parts. */
function ViewToggle({ view, onView }: { view: 'list' | 'map'; onView: (v: 'list' | 'map') => void }) {
  const one = (v: 'list' | 'map', icon: ReactNode, label: string) => (
    <button type="button" onClick={() => onView(v)} aria-pressed={view === v}
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs ${view === v ? 'bg-(--card) font-medium text-(--foreground) shadow-xs' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{icon}{label}</button>
  );
  return <div className="inline-flex rounded-lg bg-(--muted) p-0.5">{one('list', <ListChecks className="size-3.5" />, 'Checklist')}{one('map', <MapIcon className="size-3.5" />, 'Map')}</div>;
}

/** A concept or coupled parent, in full: what it's for and its parts as a checklist or a map, then their rows. */
function Dossier({ parent, parts, data, now, pick }: { parent: Item; parts: Part[]; data: BoardData; now: number; pick: Pick }) {
  const [view, setView] = useState<'list' | 'map'>('list');
  const [showDone, setShowDone] = useState(false);
  const concept = parent.number !== null ? CONCEPTS[parent.number] : undefined;
  const find = (n: number) => parts.find((p) => p.issue === n)?.item ?? findIn(data, n, parent.repo ?? undefined);
  const decisions = parts.filter((p) => p.kind !== 'build' && p.kind !== 'end-to-end');
  const builds = parts.filter((p) => p.kind === 'build');
  const repos = [...new Set(builds.map((p) => p.repo))];
  const platformName = (repo: string) => data.repos.find((r) => r.repo === repo)?.platform ?? repo.split('/')[1] ?? repo;
  const after = (repo: string) => [...new Set(builds.filter((b) => b.repo === repo).flatMap((b) => b.waitsOn)
    .flatMap((n) => builds.filter((o) => o.issue === n && o.repo !== repo).map((o) => o.repo)))];
  const repoHint = (repo: string) => repos.length < 2 ? undefined
    : after(repo).length ? `after ${after(repo).map(platformName).join(', ')}` : repos.some((r) => after(r).includes(repo)) ? 'goes first' : 'runs in parallel';
  const platforms = [...new Set(parts.map((p) => (p.item ? platformOf(p.item, data.repos) : null)).filter((p) => p !== null))];
  const items = parts.flatMap((p) => (p.item ? [p.item] : []));
  const done = items.filter((i) => i.status === 'Done').length;
  const e2e = concept?.endToEnd;
  const buildsDone = builds.every((b) => b.item?.status === 'Done');
  const threads = concept?.threads ?? [];
  const yours = parts.find((p) => p.item && YOURS.includes(p.item.status));
  const startable = parts.find((p) => p.item?.status === 'Ready' && !openWaits(p, data).length);
  const isConcept = parent.labels.includes('concept');
  const total = sum([parent, ...items]);
  const rows = parts.filter((p) => p.item && (showDone || !isDone(p)));
  const map = workOf(parent, data);

  const about = (
    <div className="grid content-start gap-5">
      {concept ? (
        <>
          <section className="grid gap-1.5"><Heading>Destination</Heading><p className="m-0 leading-relaxed">{concept.destination}</p></section>
          <section className="grid gap-1.5">
            <Heading>Decisions so far <span className="tabular-nums">{concept.decisions.length}</span></Heading>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {concept.decisions.map((d) => <li key={d} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-(--st-done)" /><span><Refs text={d} find={find} pick={pick} /></span></li>)}
            </ul>
          </section>
          <section className="grid gap-1.5">
            <Heading>Open questions <span className="tabular-nums">{concept.open.length}</span></Heading>
            {concept.open.length ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {concept.open.map((q) => <li key={q} className="flex gap-2"><CircleHelp className="mt-0.5 size-3.5 shrink-0 text-(--st-amber)" /><span><Refs text={q} find={find} pick={pick} /></span></li>)}
              </ul>
            ) : <p className="m-0 text-(--muted-foreground)">None. Every decision is made.</p>}
          </section>
        </>
      ) : <p className="m-0 text-(--muted-foreground)">No map yet: the parts come from GitHub's sub-issues.</p>}
      {e2e && (
        <section className="grid gap-1.5 rounded-lg border border-(--border) p-3">
          <Heading>End-to-end check</Heading>
          <span className="flex items-center gap-2 font-medium"><StatusGlyph status={E2E_GLYPH[e2e.state]} /><span className="min-w-0 flex-1">{e2e.title}</span><span className="text-[11px] font-normal text-(--muted-foreground)">{e2e.state}</span></span>
          <ol className="m-0 grid gap-0.5 pl-9 text-[12px] text-(--muted-foreground)">{e2e.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
      )}
    </div>
  );

  return (
    <article className="overflow-hidden rounded-xl border border-(--border) bg-(--card)">
      <div onClick={() => pick.set(parent.id)} className={`${GRID} cursor-pointer border-b border-(--border) py-3 hover:bg-(--accent) ${picked(pick.id === parent.id)}`}>
        <span className="grid min-w-0 gap-1 text-left">
          <span className="flex items-center gap-2 text-[11px] text-(--muted-foreground)">
            <span className="rounded border border-(--input) px-1.5 font-medium text-(--foreground)">{isConcept ? 'Concept' : 'Coupled work'}</span>
            <span className="truncate">{parent.status} · {done}/{items.length} parts done · {platforms.join(' + ')}</span>
          </span>
          <span className="truncate text-base font-medium tracking-tight"><ItemTitle item={parent} /></span>
          <span className="truncate text-[11px] text-(--muted-foreground)">
            {plural(threads.length, 'T3 thread')} · {threads.filter((t) => t.state === 'running').length} running · {threads.filter((t) => t.state === 'needs you').length} need you
          </span>
        </span>
        <Track status={parent.status} />
        <AgentCell s={total} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-[11px] text-(--muted-foreground)">
          {yours?.item ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); pick.set(yours.item!.id); }} className="inline-flex items-center gap-1 rounded px-1 text-(--warning-foreground) hover:bg-(--accent)">
              <StatusGlyph status={yours.item.status} className="size-3" />{refText(yours.item)} waits on you
            </button>
          ) : startable?.item ? <Act label={`Start ${refText(startable.item)}`} primary />
            : e2e?.state === 'running' ? <span>Agents run the end-to-end check</span> : <span>Nothing waits on you</span>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <ViewToggle view={view} onView={setView} />
        <span className="text-[11px] text-(--muted-foreground)">{view === 'map' ? 'Lanes by repo; arrows show what waits on what' : 'Decide, then build per repo, then the end-to-end check'}</span>
      </div>
      {view === 'map' ? (
        <div className="grid gap-5 p-4">
          <WorkMap tasks={map.tasks} mock={map.mock} data={data} now={now} pick={pick} />
          {about}
        </div>
      ) : (
        <div className="grid gap-6 p-4 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {about}
          <div className="grid content-start gap-3">
            <Heading>Parts, in order</Heading>
            {decisions.length > 0 && <Phase title="Decide" hint={`${decisions.filter(isDone).length}/${decisions.length} answered`} parts={decisions} data={data} pick={pick} />}
            {repos.map((repo) => (
              <Phase key={repo} title={<>Build <PlatformTag platform={platformName(repo)} /></>} hint={repoHint(repo)} parts={builds.filter((b) => b.repo === repo)} data={data} pick={pick} />
            ))}
            {e2e && (
              <section className="grid gap-1">
                <h4 className="m-0 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">Check<span className="font-normal normal-case tracking-normal">the agents run it once every build lands</span></h4>
                <div onClick={() => pick.set(parent.id)} className="grid cursor-pointer gap-1 rounded-md px-2 py-1.5 hover:bg-(--accent)">
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusGlyph status={E2E_GLYPH[e2e.state]} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{e2e.title}</span>
                    <span className="shrink-0 rounded border border-(--border) px-1 text-[10px] text-(--muted-foreground)"><FlaskConical className="inline size-3" /> end-to-end</span>
                    {e2e.state === 'waiting' && <Act label="Run end-to-end" primary={buildsDone} disabled={!buildsDone} />}
                    {e2e.state === 'running' && <Act label="Watch run" />}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5.5 text-[11px] text-(--muted-foreground)">
                    <span>{e2e.state}</span>
                    {builds.length > 0 && <span className="inline-flex flex-wrap items-center gap-1">waits on <WaitChips waitsOn={builds.map((b) => b.issue)} data={data} pick={pick} /></span>}
                  </span>
                  <span className="pl-5.5 text-[11px] text-(--muted-foreground)">
                    <ThreadLine thread={threads.find((t) => t.issue === parent.number)} waits={buildsDone ? [] : builds.filter((b) => b.item?.status !== 'Done').map((b) => b.issue)} />
                  </span>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-(--border)">
        <StageHeader label={`Progress · ${items.length} parts`} side="Waits on · PR" />
        {rows.map((p) => (
          <Row key={p.issue} item={p.item!} data={data} now={now} pick={pick} nested waiting={openWaits(p, data).length > 0}
            side={<PartSide part={p} data={data} pick={pick} />} />
        ))}
        {done > 0 && (
          <button type="button" onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-(--muted-foreground) hover:bg-(--accent)">
            <Check className="ml-6 size-3.5 text-(--st-done)" /><span className="flex-1">{showDone ? `Hide ${done} done` : `${done} done`}</span>{showDone ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
      </div>
    </article>
  );
}

function PartSide({ part, data, pick }: { part: Part; data: BoardData; pick: Pick }) {
  const waits = openWaits(part, data);
  if (part.item && YOURS.includes(part.item.status)) return <Side item={part.item} />;
  if (waits.length) return <span className="inline-flex items-center gap-1">waits on <WaitChips waitsOn={waits} data={data} pick={pick} /></span>;
  const pr = part.item?.linkedPrs[0];
  if (pr) return <span className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(pr)}</span>;
  return <span>{part.thread?.state ?? (part.item && THREAD_TEXT[part.item.status]) ?? ''}</span>;
}

/** The queue: items waiting to be refined, in order, each started by hand for now. */
function Queue({ items, building, data, now, pick }: { items: Item[]; building: number; data: BoardData; now: number; pick: Pick }) {
  const free = BUILD_LIMIT - building;
  return (
    <section className="overflow-hidden rounded-xl border border-(--border) bg-(--card)">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--border) px-3 py-2.5">
        <StatusGlyph status="Queued" />
        <span className="text-[13px] font-medium">Queue <span className="font-normal text-(--muted-foreground) tabular-nums">{items.length}</span></span>
        <span className="text-[11px] text-(--muted-foreground)">Starting one opens a refining thread; once refined it moves to Ready.</span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-(--muted-foreground)">
          <span className="inline-flex items-center gap-1.5 tabular-nums" title="Builds in flight against the limit">
            <span className="inline-flex gap-[3px]">{Array.from({ length: Math.max(BUILD_LIMIT, building) }, (_, n) => <span key={n} className="h-1.5 w-3 rounded-full" style={{ background: n < building ? STATUS_COLOR['In progress'] : 'var(--border)' }} />)}</span>
            {building}/{BUILD_LIMIT} building
          </span>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-(--border) px-2 py-0.5" />}>
              <span className="relative h-3 w-5 rounded-full bg-(--input)"><span className="absolute left-0.5 top-0.5 size-2 rounded-full bg-(--card)" /></span>Auto-start
            </TooltipTrigger>
            <TooltipPopup side="bottom">Later: start the next item whenever a slot frees. Off for now; you start each by hand.</TooltipPopup>
          </Tooltip>
          {items.length > 0 && <Act label="Start next" primary />}
        </span>
      </header>
      {items.length ? (
        <ol className="m-0 grid list-none p-0">
          {items.map((i, n) => (
            <li key={i.id} onClick={() => pick.set(i.id)}
              className={`flex cursor-pointer items-center gap-3 border-b border-(--border) px-3 py-2 last:border-b-0 hover:bg-(--accent) ${picked(pick.id === i.id)}`}>
              <GripVertical className="size-3.5 shrink-0 text-(--muted-foreground)" />
              <span className="w-4 shrink-0 text-right text-[11px] font-medium tabular-nums text-(--muted-foreground)">{n + 1}</span>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: platformColor(platformOf(i, data.repos)) }} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[13px]"><ItemTitle item={i} /></span>
                <span className="truncate text-[11px] text-(--muted-foreground)">{platformOf(i, data.repos)} · queued {shortAgo(i.updatedAt, now)}{i.labels.length > 0 && ` · ${i.labels.filter((l) => !l.includes(':')).join(', ')}`}</span>
              </span>
              {n === 0 && free <= 0 && <span className="shrink-0 text-[11px] text-(--muted-foreground)">next when a build slot frees</span>}
              <Act label="Start refining" primary={n === 0} />
            </li>
          ))}
        </ol>
      ) : <p className="m-0 p-6 text-center text-(--muted-foreground)">Queue empty. Queue items from List in the sidebar.</p>}
    </section>
  );
}

export function LineD({ items, data, now, pick }: LineProps) {
  const parents = data.items.filter((p) => p.number !== null && p.status !== 'List' && p.status !== 'Done'
    && (CONCEPTS[p.number] !== undefined || p.labels.includes('concept') || data.items.some((c) => childOf(c, p))));
  const shown = new Set(items.map((i) => i.id));
  const dossiers = parents.map((parent) => ({ parent, parts: partsOf(parent, data) }))
    .filter(({ parent, parts }) => shown.has(parent.id) || parts.some((p) => p.item && shown.has(p.item.id)));
  const claimed = new Set(dossiers.flatMap(({ parent, parts }) => [parent.id, ...parts.flatMap((p) => (p.item ? [p.item.id] : []))]));
  const queued = items.filter((i) => i.status === 'Queued' && !claimed.has(i.id));
  const rows = items.filter((i) => !claimed.has(i.id) && stageOf(i.status) >= 0 && i.status !== 'Done')
    .sort((a, b) => stageOf(b.status) - stageOf(a.status));
  const building = data.items.filter((i) => i.status === 'In progress').length;
  return (
    <div className="@container grid gap-4">
      <Queue items={queued} building={building} data={data} now={now} pick={pick} />
      {dossiers.map(({ parent, parts }) => <Dossier key={parent.id} parent={parent} parts={parts} data={data} now={now} pick={pick} />)}
      <div className="overflow-hidden rounded-xl border border-(--border) bg-(--card)">
        <StageHeader label={`Everything else in flight · ${rows.length}`} side="Thread · next" />
        {rows.length ? rows.map((i) => (
          <Row key={i.id} item={i} data={data} now={now} pick={pick} waiting={i.blockedBy > 0} side={<Side item={i} waiting={i.blockedBy > 0} />} />
        )) : <p className="m-0 p-6 text-center text-(--muted-foreground)">Nothing else in flight.</p>}
      </div>
      <p className="m-0 text-[11px] text-(--muted-foreground)">Prototype: agent figures for #150, #130 and #200's decisions are mocked; the sample has none for them.</p>
    </div>
  );
}
