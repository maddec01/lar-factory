// The line's dossiers: each open concept, and each open item with sub-issues on the board. A dossier starts collapsed
// to its two header lines: its kind, title and chips (parts that need you, open decisions, blocked slices, fog), then
// its part bar, parts done, what's next and repositories in columns that line up across every dossier. Opened, it
// lists what keeps the work moving (parts that need you, parts to verify or merge, open decisions, blocked slices,
// waiting parts, parts ready to start and the map's fog), then its Work map or its parts list, then each part's row
// on the stage track, its done parts folded away. The browser remembers which dossiers are open and which view each
// shows.

import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Ban, Check, ChevronDown, ChevronRight, CircleHelp, FlaskConical, GitPullRequest, ListChecks, Map as MapIcon, MessagesSquare } from 'lucide-react';
import { duration, formatTokens, formatUsd, itemTotal, kindOf, plural, prLabel, ref, repoKey, repoName } from '@lar-factory/shared';
import type { BoardData, Blocker, EndToEndCheck, Item, ItemThread } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { ICON, kind } from '../buttons/button-kinds.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { AzureFields, ItemTitle, RepoTag, SliceBar } from '../items/item-parts.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { StartAfterError } from '../items/start-after.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { ItemStatusGlyph, STATUS_COLOR, StatusGlyph } from '../items/status-glyph.tsx';
import { DECISION_KINDS, THREAD_GLYPH, dossiersOf, isDone, openWaits, threadsOf } from './dossier-parts.ts';
import type { Part } from './dossier-parts.ts';
import { PartStart, startable } from './part-start.tsx';
import { AgentCell, OnYourDesk, Row, StageHeader, stageOf, threadText, Track, YOURS, picked, statsOf } from './stage-track.tsx';
import { WorkMap } from './work-map.tsx';

const NOT_BUILT = "isn't built yet: no workflow runs an end-to-end check";

const open = (item: Item) => useItemDialogStore.getState().open(item.id);
/** Keeps a click on a control from opening the item underneath it, nor do clicks in the menu it opens. */
const stop = (e: MouseEvent) => e.stopPropagation();
const usePicked = (item: Item) => useItemDialogStore((state) => state.itemId === item.id);

/** Finds the issue `#n` names in `repo`, the dossier's own repository when the reference names none. */
type FindRef = (repo: string | undefined, n: number) => Item | undefined;

/** Text with its `#n` and `owner/repo#n` references as buttons that open the item. */
function Refs({ text, find }: { text: string; find: FindRef }) {
  return text.split(/((?:[\w.-]+\/[\w.-]+)?#\d+)/).map((bit, n) => {
    const ref = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/.exec(bit);
    const item = ref ? find(ref[1], Number(ref[2])) : undefined;
    return item
      ? <button key={n} type="button" onClick={() => open(item)} title={item.title} className="rounded px-0.5 font-medium tabular-nums text-(--primary) hover:bg-(--accent)">{bit}</button>
      : bit;
  });
}

/** One chip per issue waited on, ticked once it closes; each opens its issue when it's on the board. */
function WaitChips({ waitsOn, data }: { waitsOn: Blocker[]; data: BoardData }) {
  return waitsOn.map((b) => {
    const it = data.items.find((i) => i.number === b.number && i.repo === b.repo);
    const done = b.state !== 'open';
    return (
      <button key={`${b.repo}#${b.number}`} type="button" disabled={!it} onClick={(e) => { e.stopPropagation(); if (it) open(it); }} title={it ? `${it.title}: ${it.status}` : `${b.repo}#${b.number}`}
        className={`inline-flex items-center gap-1 rounded border px-1 tabular-nums hover:bg-(--accent) ${done ? 'border-(--border) text-(--muted-foreground)' : 'border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] text-(--warning-foreground)'}`}>
        {done ? <Check className="size-3 text-(--st-done)" /> : it && <StatusGlyph status={it.status} className="size-3" />}#{b.number}{done && ' (done)'}
      </button>
    );
  });
}

/** Blocking wording names open prerequisites alone; past prerequisites remain visible as history. */
function Prerequisites({ all, waits, data }: { all: Blocker[]; waits: Blocker[]; data: BoardData }) {
  const after = all.filter((b) => !waits.includes(b));
  return <>
    {waits.length > 0 && <span className="inline-flex flex-wrap items-center gap-1">waits on <WaitChips waitsOn={waits} data={data} /></span>}
    {after.length > 0 && <span className="inline-flex flex-wrap items-center gap-1">after <WaitChips waitsOn={after} data={data} /></span>}
  </>;
}

/** A part's thread, its title and state; before it has one, what its start waits on. */
function ThreadLine({ thread, waits }: { thread: ItemThread | undefined; waits: string[] }) {
  if (!thread) return waits.length ? <span>Thread starts when {waits.join(', ')} {waits.length > 1 ? 'are' : 'is'} done</span> : null;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={thread.title}>
      <StatusGlyph status={THREAD_GLYPH[thread.state]} className="size-3" />
      <span className="truncate">T3 · {thread.title}</span>
      <span className="shrink-0">· {thread.state}</span>
    </span>
  );
}

/** The one thing a part asks next: its Start, or its thread while one works on it. */
function PartAction({ part, data }: { part: Part; data: BoardData }) {
  switch (part.item.status) {
    case 'Ready': case 'Queued': return <PartStart part={part} data={data} />;
    case 'Shaping': case 'In progress': case 'Review': return <OpenThread item={part.item} data={data} />;
    default: return null;
  }
}

/** One step of the checklist: the part, what it waits on, its figures, its thread and its next action. */
function Step({ part, data }: { part: Part; data: BoardData }) {
  const { item } = part;
  const isPicked = usePicked(item);
  const waits = openWaits(part);
  const s = statsOf(item);
  const yours = YOURS.includes(item.status);
  return (
    <li onClick={() => open(item)} data-part={item.id} className={`grid cursor-pointer gap-1 rounded-md px-2 py-1.5 hover:bg-(--accent) ${picked(isPicked)}`}>
      {/* With no room for the action beside a readable title, it wraps under it, at the right. */}
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <ItemStatusGlyph item={item} />
        <span className="min-w-40 flex-1 truncate text-[13px]"><ItemTitle item={item} /></span>
        <span className="shrink-0 rounded border border-(--border) px-1 text-[10px] text-(--muted-foreground)">{part.kind}</span>
        {!yours && <span className="ml-auto min-w-0 max-w-full empty:hidden" onClick={stop}><PartAction part={part} data={data} /></span>}
        {yours && <span className="shrink-0 text-[11px] text-(--warning-foreground)">on your desk</span>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5.5 text-[11px] text-(--muted-foreground)">
        <span>{item.status}</span>
        <AzureFields azure={item.azure} />
        {s && <span className="tabular-nums">{duration(s.agentMs)} · {formatTokens(s.tokens)} · {s.costUsd !== undefined ? formatUsd(s.costUsd) : 'Unavailable'}</span>}
        {item.slices.length > 0 && <span className="tabular-nums">{item.slices.filter((x) => x.progress === 'done').length}/{item.slices.length} slices</span>}
        <Prerequisites all={part.waitsOn} waits={waits} data={data} />
        {item.linkedPrs.map((pr) => <span key={pr.number} className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(pr)}</span>)}
      </span>
      {item.slices.length > 0 && <span className="pl-5.5"><SliceBar item={item} /></span>}
      <span className="min-w-0 pl-5.5 text-[11px] text-(--muted-foreground) empty:hidden"><ThreadLine thread={part.thread} waits={waits.map((b) => `#${b.number}`)} /></span>
    </li>
  );
}

function PhaseTitle({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return <h4 className="m-0 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">{title}{hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}</h4>;
}

/** The parts of one phase, the done ones folded into a single line until you open it. */
function Phase({ title, hint, parts, data }: { title: ReactNode; hint?: ReactNode; parts: Part[]; data: BoardData }) {
  const [showDone, setShowDone] = useState(false);
  const done = parts.filter((p) => isDone(p.item));
  const ahead = parts.filter((p) => !isDone(p.item));
  return (
    <section className="grid gap-1" data-phase>
      <PhaseTitle title={title} hint={hint} />
      <ol className="m-0 grid list-none gap-0.5 p-0">
        {ahead.map((p) => <Step key={p.item.id} part={p} data={data} />)}
        {done.length > 0 && (
          <li>
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] text-(--muted-foreground) hover:bg-(--accent)">
              <Check className="size-3.5 text-(--st-done)" /><span className="flex-1">{done.length} done</span>{showDone ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          </li>
        )}
        {showDone && done.map((p) => <Step key={p.item.id} part={p} data={data} />)}
      </ol>
    </section>
  );
}

/** The checklist's last phase: the end-to-end check, which waits on every build. Running and watching it aren't built yet. */
function CheckPhase({ check, parent, builds, data }: { check: EndToEndCheck; parent: Item; builds: Part[]; data: BoardData }) {
  const waitsOn: Blocker[] = builds.map((b) => ({ number: b.item.number!, repo: b.item.repo!, state: isDone(b.item) ? 'closed' : 'open' }));
  return (
    <section className="grid gap-1" data-phase="check">
      <PhaseTitle title="Check" hint="the agents run it once every build lands" />
      <div onClick={() => open(parent)} className="grid cursor-pointer gap-1 rounded-md px-2 py-1.5 hover:bg-(--accent)">
        {/* The title wraps rather than truncates; with no room beside it, the buttons wrap under it, at the right. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusGlyph status="Queued" />
          <span className="min-w-48 flex-1 text-[13px]">{check.title}</span>
          <span className="shrink-0 rounded border border-(--border) px-1 text-[10px] text-(--muted-foreground)"><FlaskConical className="inline size-3" /> end-to-end</span>
          <span className="ml-auto flex shrink-0 gap-1" onClick={stop}>
            {/* Pointer events stay on while they're disabled, so their titles say why. */}
            <Button {...kind('start')} leftIcon={ICON.play} className="disabled:pointer-events-auto" disabled title={`Run end-to-end ${NOT_BUILT}`}>Run end-to-end</Button>
            <Button {...kind('start')} leftIcon={ICON.play} className="disabled:pointer-events-auto" disabled title={`Watch run ${NOT_BUILT}`}>Watch run</Button>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5.5 text-[11px] text-(--muted-foreground)">
          <span>waiting</span>
          <Prerequisites all={waitsOn} waits={waitsOn.filter((b) => b.state === 'open')} data={data} />
        </span>
        <span className="pl-5.5 text-[11px] text-(--muted-foreground) empty:hidden">
          <ThreadLine thread={threadsOf(parent)[0]} waits={waitsOn.filter((w) => w.state === 'open').map((w) => `#${w.number}`)} />
        </span>
      </div>
    </section>
  );
}

type View = 'list' | 'map';

/** A dossier setting this browser remembers across reloads, stored as a string under `lar-board:dossier-<name>:<id>`. */
interface Stored<T> {
  name: string;
  /** The setting from what was stored, or from null before anything is. */
  read: (stored: string | null) => T;
  write: (value: T) => string;
}

/** Open or collapsed, stored as '1' or '0'; a dossier starts collapsed. */
const OPEN: Stored<boolean> = { name: 'open', read: (s) => s === '1', write: (on) => (on ? '1' : '0') };
/** Work map or parts list; a dossier starts on its Work map. */
const VIEW: Stored<View> = { name: 'view', read: (s) => (s === 'list' ? 'list' : 'map'), write: (v) => v };

function useStored<T>({ name, read, write }: Stored<T>, parent: Item): [T, (v: T) => void] {
  const key = `lar-board:dossier-${name}:${parent.id}`;
  const [value, setValue] = useState(() => read(localStorage.getItem(key)));
  return [value, (v) => {
    localStorage.setItem(key, write(v));
    setValue(v);
  }];
}

/** Work map or parts list: one dossier's way of drawing its parts. */
function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
  const one = (v: View, icon: ReactNode, label: string) => (
    <button type="button" onClick={() => onView(v)} aria-pressed={view === v}
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs ${view === v ? 'bg-(--card) font-medium text-(--foreground) shadow-xs' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{icon}{label}</button>
  );
  return <div className="inline-flex rounded-lg bg-(--muted) p-0.5">{one('map', <MapIcon className="size-3.5" />, 'Work map')}{one('list', <ListChecks className="size-3.5" />, 'Parts list')}</div>;
}

/** A part as a link to its item dialog: its status and its title, up to two lines. */
function PartLink({ part }: { part: Part }) {
  return (
    <button type="button" onClick={() => open(part.item)} title={`${ref(part.item)} ${part.item.title}`}
      className="flex min-w-0 items-start gap-1.5 rounded text-left text-[13px] hover:underline">
      <span className="mt-0.5 inline-flex"><ItemStatusGlyph item={part.item} className="size-3.5" /></span>
      <span className="line-clamp-2"><ItemTitle item={part.item} /></span>
    </button>
  );
}

/** One entry of an attention row, with what it waits on or its next action at the right. */
function Entry({ main, side }: { main: ReactNode; side?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md px-1.5 py-1 hover:bg-(--soft)">
      <span className="min-w-0 flex-1 basis-64">{main}</span>
      {side && <span className="ml-auto shrink-0 text-[11px] text-(--muted-foreground)">{side}</span>}
    </div>
  );
}

/** What keeps the work moving, as labelled rows, each shown only with entries: parts in Needs you, parts in Verify or
 *  Ready to merge, open decisions, blocked slices, parts waiting on others, parts ready to start and the map's fog. */
function Attention({ parent, parts, data, find }: { parent: Item; parts: Part[]; data: BoardData; find: FindRef }) {
  const ahead = parts.filter((p) => !isDone(p.item));
  const blocked = ahead.flatMap((part) => part.item.slices.filter((s) => s.progress === 'blocked').map((slice) => ({ part, slice })));
  const rows = [
    { key: 'you', label: 'Needs you', tone: 'text-(--warning-foreground)',
      entries: ahead.filter((p) => p.item.status === 'Needs you').map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={<OpenThread item={p.item} data={data} />} />) },
    { key: 'verify', label: 'To verify or merge', tone: 'text-(--warning-foreground)',
      entries: ahead.filter((p) => p.item.status === 'Verify' || p.item.status === 'Ready to merge').map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={p.item.status} />) },
    { key: 'decisions', label: 'Open decisions', tone: 'text-(--primary)',
      entries: ahead.filter((p) => DECISION_KINDS.includes(p.kind)).map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={`${p.kind} · ${p.item.status}`} />) },
    { key: 'blocked', label: 'Blocked slices', tone: 'text-(--st-review)',
      entries: blocked.map(({ part, slice }) => (
        <Entry key={`${slice.repo}#${slice.number}`}
          main={<span className="flex min-w-0 items-start gap-1.5 text-[13px]"><Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" /><span className="line-clamp-2"><span className="tabular-nums text-(--muted-foreground)">#{slice.number}</span> {slice.title}</span></span>}
          side={<>slice of <button type="button" onClick={() => open(part.item)} title={part.item.title} className="rounded px-0.5 font-medium tabular-nums text-(--primary) hover:bg-(--accent)">{ref(part.item)}</button> · waits on a re-slice</>} />
      )) },
    { key: 'waiting', label: 'Waiting', tone: 'text-(--muted-foreground)',
      entries: ahead.filter((p) => openWaits(p).length && p.item.status !== 'Needs you').map((p) => (
        <Entry key={p.item.id} main={<PartLink part={p} />} side={<span className="inline-flex items-center gap-1">waits on <WaitChips waitsOn={openWaits(p)} data={data} /></span>} />
      )) },
    { key: 'ready', label: 'Ready to start', tone: 'text-(--st-now)',
      entries: ahead.filter(startable).map((p) => (
        <Entry key={p.item.id} main={<PartLink part={p} />} side={<span onClick={stop}><PartStart part={p} data={data} label="Start" /></span>} />
      )) },
    { key: 'fog', label: 'Fog', tone: 'text-(--st-amber)',
      entries: (parent.map?.fog ?? []).map((q) => (
        <Entry key={q} main={<span className="flex items-start gap-1.5 text-[13px]"><CircleHelp className="mt-0.5 size-3.5 shrink-0 text-(--st-amber)" /><span><Refs text={q} find={find} /></span></span>} />
      )) },
  ].filter((r) => r.entries.length);
  if (!rows.length) return null;
  return (
    <dl className="m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 pt-3" data-attention>
      {rows.map((r) => (
        <div key={r.key} className="contents" data-attention-row={r.key}>
          <dt className={`pt-1 text-[11px] font-medium uppercase tracking-wide ${r.tone}`}>{r.label} <span className="tabular-nums">{r.entries.length}</span></dt>
          <dd className="m-0 grid gap-0.5">{r.entries}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The progress row's side: where a part waits on you, what it waits on, its PR, or what its thread is doing. */
function PartSide({ part, data }: { part: Part; data: BoardData }) {
  const { item } = part;
  const waits = openWaits(part);
  if (YOURS.includes(item.status)) return <OnYourDesk status={item.status} />;
  if (waits.length) return <span className="inline-flex items-center gap-1">waits on <WaitChips waitsOn={waits} data={data} /></span>;
  const pr = item.linkedPrs[0];
  if (pr) return <span className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(pr)}</span>;
  return <span>{threadText(item)}</span>;
}

/** The header's side: the part that waits on you, else the first part that can start, else that nothing waits on you. */
function HeaderSide({ parts, data, missing }: { parts: Part[]; data: BoardData; missing: number }) {
  const yours = parts.find((p) => YOURS.includes(p.item.status));
  const first = parts.find((p) => !isDone(p.item) && startable(p));
  const note = (text: string) => <span className="truncate" title={text}>{text}</span>;
  if (yours) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); open(yours.item); }} title={`${ref(yours.item)} ${yours.item.title}`}
        className="flex min-w-0 items-center gap-1 rounded px-1 text-(--warning-foreground) hover:bg-(--accent)">
        <StatusGlyph status={yours.item.status} className="size-3 shrink-0" /><span className="truncate">{ref(yours.item)} waits on you</span>
      </button>
    );
  }
  if (first) return <span className="min-w-0" onClick={stop}><PartStart part={first} data={data} label={`Start ${ref(first.item)}`} /></span>;
  return note(missing ? 'Some parts are outside the board' : 'Nothing waits on you');
}

/** Line 1's thread counts and Azure fields: they give up their room before the title does, ending in an ellipsis.
 *  Below `lg` they may shrink to nothing, so a narrow line's title keeps its room; their tooltips keep the text. */
const META = 'min-w-0 lg:min-w-10 shrink-[1000] truncate';

/** Line 2's columns, the same fixed widths in every dossier: part bar, parts done, what's next, and repositories,
 *  which drop below 1024 px. "What's next" takes the rest, so it shrinks first. */
const LINE2 = 'grid grid-cols-[18rem_5.5rem_minmax(0,1fr)] items-center gap-x-4 lg:grid-cols-[18rem_5.5rem_minmax(0,1fr)_9rem]';

/** Every part as a segment in its status colour, done first, so the bar fills left to right; a dashed one per part the board doesn't read. */
function PartBar({ parts, count }: { parts: Part[]; count: number }) {
  const order = [...parts].sort((a, b) => Number(isDone(b.item)) - Number(isDone(a.item)) || stageOf(b.item.status) - stageOf(a.item.status));
  return (
    <ol className="m-0 flex min-w-0 list-none gap-[2px] p-0" data-part-bar>
      {order.map(({ item }) => (
        <li key={item.id} title={`${ref(item)} ${item.title}: ${item.status}`} className={`h-1.5 min-w-[3px] flex-1 rounded-full ${item.status === 'In progress' ? 'status-pulse' : ''}`}
          style={{ background: isDone(item) ? 'var(--st-done)' : item.status === 'Queued' || item.status === 'List' ? 'var(--soft)' : STATUS_COLOR[item.status] }} />
      ))}
      {Array.from({ length: Math.max(0, count - parts.length) }, (_, n) => <li key={n} className="h-1.5 min-w-[3px] flex-1 rounded-full border border-dashed border-(--input)" />)}
    </ol>
  );
}

/** The dossier's T3 threads, then how many run and how many wait for the user's reply, each left out at zero,
 *  so the threads' wording never contradicts the "need you" chip, which counts parts. */
function threadCounts(threads: ReturnType<typeof threadsOf>): string {
  const running = threads.filter((t) => t.state === 'running').length;
  const waiting = threads.filter((t) => t.state === 'needs you').length;
  return [plural(threads.length, 'T3 thread'), running && `${running} running`, waiting && `${waiting} awaiting your reply`].filter(Boolean).join(' · ');
}

/** A count chip, hidden at zero. */
function Chip({ n, word, tone, icon }: { n: number; word: string; tone: 'warning' | 'danger' | 'neutral' | 'accent'; icon: ReactNode }) {
  if (!n) return null;
  return <Badge tone={tone} className="whitespace-nowrap tabular-nums" data-chip>{icon}{n} {word}</Badge>;
}

/** What needs the user's eye: parts in Needs you, open decisions, blocked slices and the map's remaining fog. */
function Chips({ parent, parts }: { parent: Item; parts: Part[] }) {
  const ahead = parts.filter((p) => !isDone(p.item));
  const decisions = ahead.filter((p) => DECISION_KINDS.includes(p.kind)).length;
  return <>
    <Chip n={ahead.filter((p) => p.item.status === 'Needs you').length} word="need you" tone="warning" icon={<StatusGlyph status="Needs you" className="size-3" />} />
    <Chip n={decisions} word={decisions === 1 ? 'decision' : 'decisions'} tone="accent" icon={<MessagesSquare />} />
    <Chip n={ahead.flatMap((p) => p.item.slices).filter((x) => x.progress === 'blocked').length} word="blocked" tone="danger" icon={<Ban />} />
    <Chip n={parent.map?.fog.length ?? 0} word="fog" tone="neutral" icon={<CircleHelp />} />
  </>;
}

/** A concept or coupled parent, in full: what keeps it moving, its parts as a Work map or a list, then their rows. */
function Dossier({ parent, parts, data, now }: { parent: Item; parts: Part[]; data: BoardData; now: number }) {
  const [view, setView] = useStored(VIEW, parent);
  const [on, setOpen] = useStored(OPEN, parent);
  const [showDone, setShowDone] = useState(false);
  // Letting go of a drag that selected text in the header leaves the dossier as it was; a key press on the chevron
  // (a click with no detail) or a selection elsewhere on the page still toggles it.
  const toggle = (e: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (e.detail > 0 && selection && !selection.isCollapsed && e.currentTarget.contains(selection.anchorNode)) return;
    setOpen(!on);
  };
  const isPicked = usePicked(parent);
  const items = parts.map((p) => p.item);
  const find: FindRef = (repo = parent.repo ?? '', n) => data.items.find((i) => i.number === n && i.repo?.toLowerCase() === repo.toLowerCase());
  const builds = parts.filter((p) => p.kind === 'build');
  // Group adjacent decisions or builds from one repository without changing dependency order.
  const groups: Part[][] = [];
  parts.forEach((part) => {
    const previous = groups.at(-1);
    if (previous && (previous[0]!.kind === 'build') === (part.kind === 'build')
      && (part.kind !== 'build' || previous[0]!.item.repo === part.item.repo)) previous.push(part);
    else groups.push([part]);
  });
  const repoHint = (group: Part[]) => {
    if (new Set(builds.map((b) => b.item.repo)).size < 2) return undefined;
    const repo = group[0]!.item.repo;
    const before = [...new Set(group.flatMap((b) => b.waitsOn).flatMap((w) => builds
      .filter((b) => b.item.repo === w.repo && b.item.number === w.number && w.repo !== repo).map((b) => b.item.repo!)))];
    if (before.length) return `after ${before.map((r) => repoName(r, data.repos)).join(', ')}`;
    return builds.some((b) => b.item.repo !== repo && b.waitsOn.some((w) => group.some((p) => p.item.repo === w.repo && p.item.number === w.number)))
      ? 'goes first' : 'runs in parallel';
  };
  const names = [...new Set(items.map((i) => repoName(repoKey(i), data.repos)))];
  const done = items.filter(isDone).length;
  const count = Math.max(parent.subIssues.total, items.length);
  const missing = count - items.length;
  const completed = Math.max(parent.subIssues.completed, done);
  const threads = [parent, ...items].flatMap(threadsOf);
  const total = itemTotal(parent, data.items) ?? parent.stats;
  const rows = parts.filter((p) => showDone || !isDone(p.item));
  const check = parent.map?.check;

  return (
    <article className="overflow-hidden rounded-xl border border-(--border) bg-(--card)" data-dossier={parent.id}>
      {/* Only the title opens the item; anywhere else on the two lines but the chips opens or closes the dossier. */}
      <div onClick={toggle} data-item={parent.id} data-open={on} className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-2 py-2 hover:bg-(--accent) ${on ? 'border-b border-(--border)' : ''} ${picked(isPicked)}`}>
        <button type="button" aria-expanded={on} aria-label={on ? 'Collapse' : 'Expand'}
          className="grid size-6 place-items-center rounded-md text-(--muted-foreground) hover:bg-(--soft) hover:text-(--foreground)">
          {on ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="flex min-w-0 items-start justify-between gap-x-2 pt-0.5" data-line="1">
          {/* One row: the threads and Azure fields shrink first, down to an ellipsis, so the title keeps its room. */}
          <span className="flex min-w-0 flex-1 items-baseline gap-x-2">
            {/* The badge and title stay together, so a long title wraps beside the badge instead of below it. */}
            <span className="flex min-w-0 items-start gap-x-2">
              <Badge tone="neutral" className="shrink-0">{kindOf(parent) === 'concept' ? 'Concept' : 'Coupled work'}</Badge>
              <button type="button" onClick={(e) => { e.stopPropagation(); open(parent); }} data-title
                className="min-w-0 rounded text-left text-[14px] font-medium tracking-tight hover:underline"><ItemTitle item={parent} /></button>
            </span>
            <span className={`${META} text-[11px] text-(--muted-foreground)`} title={threadCounts(threads)} data-threads>
              {threadCounts(threads)}
            </span>
            <span className={`${META} empty:hidden`}><AzureFields azure={parent.azure} /></span>
          </span>
          <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 gap-1" data-chips><Chips parent={parent} parts={parts} /></span>
        </span>
        <span className="row-span-2 grid w-[11rem] grid-cols-[minmax(0,1fr)] items-center gap-x-4 @2xl:w-[19rem] @2xl:grid-cols-[minmax(0,1fr)_6rem]" data-figures>
          <Track status={parent.status} />
          <AgentCell s={total && total !== 'unavailable' ? total : null} />
        </span>
        <span className={`col-start-2 ${LINE2} text-[11px] text-(--muted-foreground)`} data-line="2">
          <PartBar parts={parts} count={count} />
          <span className="tabular-nums">{completed}/{count} parts</span>
          <span className="flex min-w-0 items-center" data-next><HeaderSide parts={parts} data={data} missing={missing} /></span>
          <span className="hidden truncate text-right lg:block" title={names.join(' + ')} data-repos>{names.join(' + ')}</span>
        </span>
      </div>

      {on && <>
        {missing > 0 && <p className="m-0 px-4 pt-3 text-xs text-(--muted-foreground)" data-unread-parts>
          {plural(missing, 'part')} the board doesn't read. A repository may no longer be on the board.
        </p>}
        <Attention parent={parent} parts={parts} data={data} find={find} />
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <ViewToggle view={view} onView={setView} />
          <span className="text-[11px] text-(--muted-foreground)">{view === 'map' ? 'Lanes by repo; arrows show what waits on what' : 'Parts follow their dependencies, then the end-to-end check'}</span>
        </div>
        {view === 'map' ? (
          <div className="p-4"><WorkMap parts={parts} check={check} data={data} now={now} /></div>
        ) : (
          <div className="grid content-start gap-3 p-4 @3xl:grid-cols-2" data-checklist>
            {groups.map((group) => (
              <Phase key={group[0]!.item.id}
                title={group[0]!.kind === 'build' ? <>Build <RepoTag repo={group[0]!.item.repo!} repos={data.repos} /></> : 'Decide'}
                hint={group[0]!.kind === 'build' ? repoHint(group) : `${group.filter((p) => isDone(p.item)).length}/${group.length} answered`}
                parts={group} data={data} />
            ))}
            {check && <CheckPhase check={check} parent={parent} builds={builds} data={data} />}
          </div>
        )}

        <div className="border-t border-(--border)">
          <StageHeader label={`Progress · ${count} parts`} side="Waits on · PR" />
          {rows.map((p) => (
            <Row key={p.item.id} item={p.item} data={data} now={now} nested waiting={openWaits(p).length > 0} side={<PartSide part={p} data={data} />}>
              {(p.item.status === 'Ready' || p.item.status === 'Queued') && (
                <div className="px-3 pb-2 pl-12 empty:hidden" onClick={stop}><StartMessage item={p.item} kind={p.item.status === 'Ready' ? 'build' : 'refine'} /><StartAfterError item={p.item} data={data} /></div>
              )}
            </Row>
          ))}
          {done > 0 && (
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-(--muted-foreground) hover:bg-(--accent)">
              <Check className="ml-6 size-3.5 text-(--st-done)" /><span className="flex-1">{showDone ? `Hide ${done} done` : `${done} done`}</span>{showDone ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          )}
        </div>
      </>}
    </article>
  );
}

/** `items` are the line's items in the main area's scope. */
export function Dossiers({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  return dossiersOf(items, data.items).map(({ parent, parts }) => <Dossier key={parent.id} parent={parent} parts={parts} data={data} now={now} />);
}
