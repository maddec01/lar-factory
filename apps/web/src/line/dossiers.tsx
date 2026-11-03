// The dock, Concepts and linked work: each started concept, and each open item with sub-issues on the board, as one
// line: its kind, title and chips (parts that need you, open decisions, blocked slices, fog, whether it is refined), then
// what's next, its part bar, parts done, agent figures and repositories in columns that line up across every dossier.
// Opened, it takes the whole workspace under that same line and starts on its Work map, with the concept's own question
// above and its Dependencies and fog below. Its parts list instead lists what keeps the work moving (parts that need you,
// parts to verify or merge, open decisions, blocked slices, waiting parts, parts ready to start, Dependencies and fog) or
// says nothing holds it up, then each part with what it asks next, its stage track, figures, thread and slices, the done
// parts folded away. The browser remembers which view each dossier shows.

import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { ArrowLeft, Ban, Check, ChevronRight, CircleHelp, GitPullRequest, ListChecks, Map as MapIcon, MessagesSquare } from 'lucide-react';
import { UNREADABLE, needsAnswer, openQuestionThread, blockerGroups, blockerRef, canRetryBuild, currentBuildThread, plural, prLabel, itemName, ref, repoKey, repoName, workingAgain } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { dependenciesOf } from '../items/dependencies.tsx';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { AzureFields, ItemTitle, SliceBar, StructureSync, shownStatus, useActivityUnavailable, usageUnreadable, useShownStatus } from '../items/item-parts.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { StartAfterError } from '../items/start-after.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { StatusGlyph, STATUS_COLOR } from '../items/status-glyph.tsx';
import { DECISION_KINDS, THREAD_GLYPH, isDone, openWaits, partLabel, shownThread, threadAtWork, threadsOf } from './dossier-parts.ts';
import type { DossierItems, Part } from './dossier-parts.ts';
import { StartBuild } from '../items/start-build.tsx';
import { PartStart, startable } from './part-start.tsx';
import { DOCK_COLUMNS, Figures, figuresOf } from './columns.tsx';
import { Pane } from './pane.tsx';
import { OnYourDesk, Track, lastSeen, stageOf, YOURS, picked } from './stage-track.tsx';
import { PartKindLabel, WorkMap } from './work-map.tsx';

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

/** What a part waits on, as plain muted text: `waits on #305, #306`. */
const waitsOn = (part: Part) => `waits on ${openWaits(part).map((b) => blockerRef(part.item, b)).join(', ')}`;

/** A part's thread, its title and state; before it has one, what its start waits on. */
function ThreadLine({ part }: { part: Part }) {
  const thread = shownThread(part, useShownStatus(part.item).working);
  if (!thread) {
    const { work, dependencies } = blockerGroups(part.item, openWaits(part));
    const waits = [...work ? [work.names] : [], ...dependencies ? [`you to mark ${dependencies.names} met`] : []];
    return waits.length ? <span>Waiting on {waits.join(' and ')}</span> : null;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={thread.title}>
      <StatusGlyph status={THREAD_GLYPH[thread.state]} className="size-3" />
      <span className="truncate">T3 · {thread.title}</span>
      <span className="shrink-0">· {thread.archived ? 'archived' : thread.state}{lastSeen(thread)}</span>
    </span>
  );
}

type View = 'list' | 'map';

/** Work map or parts list, stored per dossier in this browser; a dossier starts on its Work map. */
function useView(parent: Item): [View, (v: View) => void] {
  const key = `lar-board:dossier-view:${parent.id}`;
  const [value, setValue] = useState<View>(() => (localStorage.getItem(key) === 'list' ? 'list' : 'map'));
  return [value, (v) => {
    localStorage.setItem(key, v);
    setValue(v);
  }];
}

/** Work map or parts list: one dossier's way of drawing its parts. */
function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
  const one = (v: View, icon: ReactNode, label: string) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onView(v); }} aria-pressed={view === v}
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs ${view === v ? 'bg-(--card) font-medium text-(--foreground) shadow-xs' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{icon}{label}</button>
  );
  return <div className="inline-flex rounded-lg bg-(--muted) p-0.5">{one('map', <MapIcon className="size-3.5" />, 'Work map')}{one('list', <ListChecks className="size-3.5" />, 'Parts list')}</div>;
}

/** A part as a link to its item dialog: its status and its title, up to two lines. */
function PartLink({ part }: { part: Part }) {
  const { glyph } = useShownStatus(part.item);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open(part.item); }} title={`${itemName(part.item)}`}
      className="flex min-w-0 items-start gap-1.5 rounded text-left text-[13px] hover:underline">
      <SourceIcon item={part.item} />
      <span className="mt-0.5 inline-flex"><StatusGlyph status={glyph} className="size-3.5" /></span>
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
 *  Ready to merge, open decisions, blocked slices, parts waiting on others, parts ready to start, Dependencies, met or
 *  not, and the map's fog. `only` limits it to those rows for the parent, since the Work map draws its parts itself. */
function Attention({ parent, parts, data, find, only }: { parent: Item; parts: Part[]; data: BoardData; find: FindRef; only?: readonly string[] }) {
  const unavailable = useActivityUnavailable();
  const unfinished = parts.filter((p) => !isDone(p.item));
  const ahead = only ? [] : unfinished;
  const holds = unfinished.flatMap((part) => dependenciesOf(part.item).map((hold) => ({ part, hold })));
  // A map's line naming a Dependency the records hold says less than the record, so it goes.
  const written = (parent.map?.dependencies ?? []).filter((d) => !holds.some(({ hold }) => hold.need && d.toLowerCase().includes(hold.need.toLowerCase())));
  const blocked = ahead.flatMap((part) => part.item.slices.filter((s) => s.progress === 'blocked').map((slice) => ({ part, slice })));
  const rows = [
    { key: 'you', label: 'Needs you', tone: 'text-(--warning-foreground)',
      entries: [...(needsAnswer(parent) ? [<Entry key={parent.id} main={<button onClick={() => open(parent)}>{itemName(parent)}</button>} side={<OpenThread item={parent} data={data} threadId={openQuestionThread(parent)?.id} label="Answer in T3" />} />] : []), ...ahead.filter((p) => needsAnswer(p.item)).map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={<OpenThread item={p.item} data={data} threadId={openQuestionThread(p.item)?.id} label="Answer in T3" />} />)] },
    { key: 'verify', label: 'To verify or merge', tone: 'text-(--warning-foreground)',
      entries: ahead.filter((p) => (p.item.status === 'Verify' || p.item.status === 'Ready to merge') && !workingAgain(p.item, unavailable)).map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={p.item.status} />) },
    { key: 'decisions', label: 'Open decisions', tone: 'text-(--primary)',
      entries: ahead.filter((p) => DECISION_KINDS.includes(p.kind)).map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={`${partLabel(p.kind)} · ${shownStatus(p.item, unavailable).word}`} />) },
    { key: 'blocked', label: 'Blocked slices', tone: 'text-(--st-review)',
      entries: blocked.map(({ part, slice }, i) => (
        <Entry key={i}
          main={<span className="flex min-w-0 items-start gap-1.5 text-[13px]"><Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" /><span className="line-clamp-2">{slice.number > 0 && <><span className="tabular-nums text-(--muted-foreground)">#{slice.number}</span> </>}{slice.title}</span></span>}
          side={<>slice of <button type="button" onClick={() => open(part.item)} title={part.item.title} className="rounded px-0.5 font-medium tabular-nums text-(--primary) hover:bg-(--accent)">{ref(part.item)}</button> · waits on a re-slice</>} />
      )) },
    { key: 'waiting', label: 'Waiting', tone: 'text-(--muted-foreground)',
      entries: ahead.filter((p) => openWaits(p).length && !needsAnswer(p.item)).map((p) => (
        <Entry key={p.item.id} main={<PartLink part={p} />} side={waitsOn(p)} />
      )) },
    { key: 'ready', label: 'Ready to start', tone: 'text-(--st-now)',
      entries: ahead.filter(startable).map((p) => (
        <Entry key={p.item.id} main={<PartLink part={p} />} side={<span onClick={stop}><PartStart part={p} data={data} label="Start" /></span>} />
      )) },
    { key: 'dependencies', label: 'Dependencies', tone: 'text-(--st-review)',
      entries: [...holds.map(({ part, hold }) => (
        <Entry key={`${part.item.id} ${hold.dependencyId}`}
          main={<span className="flex items-start gap-1.5 text-[13px]" data-dependency-state={hold.met ? 'met' : 'unmet'}>{hold.met ? <Check className="mt-0.5 size-3.5 shrink-0 text-(--st-done)" /> : <Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" />}<span>{hold.owner}: {hold.need}</span></span>}
          side={<>{hold.met ? 'met' : 'not met'} · holds <button type="button" onClick={() => open(part.item)} title={part.item.title} className="rounded px-0.5 font-medium tabular-nums text-(--primary) hover:bg-(--accent)">{ref(part.item)}</button></>} />
      )), ...written.map((d) => (
        <Entry key={d} main={<span className="flex items-start gap-1.5 text-[13px]"><Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" /><span><Refs text={d} find={find} /></span></span>} />
      ))] },
    { key: 'fog', label: 'Fog', tone: 'text-(--st-amber)',
      entries: (parent.map?.fog ?? []).map((q) => (
        <Entry key={q} main={<span className="flex items-start gap-1.5 text-[13px]"><CircleHelp className="mt-0.5 size-3.5 shrink-0 text-(--st-amber)" /><span><Refs text={q} find={find} /></span></span>} />
      )) },
  ].filter((r) => r.entries.length && (!only || only.includes(r.key)));
  if (!rows.length && only) return null;
  if (!rows.length) return <p className="m-0 text-[13px] text-(--muted-foreground)" data-attention-none>Nothing holds this up.</p>;
  return (
    // The labels' column is 7.5rem, or as wide as the longest label so none wraps ("To verify or merge" needs more).
    <dl className="m-0 grid grid-cols-[minmax(7.5rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-2" data-attention>
      {rows.map((r) => (
        <div key={r.key} className="contents" data-attention-row={r.key}>
          <dt className={`whitespace-nowrap pt-1 text-[11px] font-medium uppercase tracking-wide ${r.tone}`}>{r.label} <span className="tabular-nums">{r.entries.length}</span></dt>
          <dd className="m-0 grid gap-0.5">{r.entries}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The one thing a part asks next: on your desk, or its Start (or Start after while it waits). Otherwise its thread,
 *  when it has one, or while its status says one works on it, and what it waits on beside that. */
function Action({ part, data }: { part: Part; data: BoardData }) {
  const { status } = part.item;
  const { working } = useShownStatus(part.item);
  const done = isDone(part.item);
  if (!done && working) return <span onClick={stop}><OpenThread item={part.item} data={data} threadId={currentBuildThread(part.item)?.id} /></span>;
  if (!done && YOURS.includes(status)) return <OnYourDesk status={status} />;
  if (!done && (status === 'Ready' || status === 'Queued')) return <span onClick={stop}><PartStart part={part} data={data} label="Start" /></span>;
  const waiting = !done && openWaits(part).length > 0;
  if (!done && !waiting && canRetryBuild(part.item)) return <span onClick={stop}><StartBuild item={part.item} data={data} /></span>;
  const thread = threadsOf(part.item).length > 0 || (!done && !waiting && ['Shaping', 'In progress', 'Review'].includes(status));
  return <>
    {waiting && <span className="max-w-48 truncate" title={waitsOn(part)}>{waitsOn(part)}</span>}
    {thread && <span onClick={stop}><OpenThread item={part.item} data={data} /></span>}
  </>;
}

/** One part of the parts list: its title and what it asks next, then its stage track, status, agent figures, Azure
 *  fields, PR and thread, its slice bar, and its start's message or error. */
function PartRow({ part, data }: { part: Part; data: BoardData }) {
  const { item } = part;
  const isPicked = usePicked(item);
  const waits = openWaits(part);
  const shown = useShownStatus(item);
  const s = figuresOf(item, data);
  return (
    <li onClick={() => open(item)} data-part={item.id} className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 hover:bg-(--accent) ${picked(isPicked)}`}>
      <span className="flex min-w-0 items-center gap-2"><PartLink part={part} /></span>
      <span className="flex items-center justify-end gap-2 text-[11px] text-(--muted-foreground)">
        {item.slices.length > 0 && <span className="tabular-nums">{item.slices.filter((x) => x.progress === 'done').length}/{item.slices.length}</span>}
        <Action part={part} data={data} />
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[11px] text-(--muted-foreground)" data-part-meta>
        <PartKindLabel kind={part.kind} />
        <span className="w-28 shrink-0"><Track status={isDone(item) ? 'Done' : item.status} label={shown.word} waiting={waits.length > 0} /></span>
        <span>{isDone(item) ? 'Complete' : shown.word}</span>
        {s ? <Figures s={s} /> : usageUnreadable(item) && <span>{UNREADABLE}</span>}
        <AzureFields azure={item.azure} />
        {item.linkedPrs.map((pr) => <span key={pr.number} className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(pr)}</span>)}
        <span className="min-w-0 empty:hidden"><ThreadLine part={part} /></span>
      </span>
      {item.slices.length > 0 && <span className="col-span-2 pl-3.5"><SliceBar item={item} /></span>}
      {!isDone(item) && ['Ready', 'Queued', 'In progress'].includes(item.status) && (
        <span className="col-span-2 pl-5 empty:hidden" onClick={stop}><StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} /><StartAfterError item={item} data={data} /></span>
      )}
    </li>
  );
}

/** The parts list: one row per open part in two columns where there's room, the done ones folded into a count. */
function PartsList({ parts, data }: { parts: Part[]; data: BoardData }) {
  const [showDone, setShowDone] = useState(false);
  const shown = parts.filter((p) => showDone || !isDone(p.item));
  const done = parts.filter((p) => isDone(p.item)).length;
  return (
    <div className="grid gap-1">
      <ol className="m-0 grid list-none gap-x-4 gap-y-0.5 p-0 @4xl:grid-cols-2" data-parts-list>
        {shown.map((p) => <PartRow key={p.item.id} part={p} data={data} />)}
      </ol>
      {done > 0 && <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="justify-self-start rounded px-2 py-1 text-[11px] text-(--muted-foreground) hover:bg-(--accent)">{showDone ? `Hide ${done} done` : `Show ${done} done`}</button>}
    </div>
  );
}

type Slice = Item['slices'][number];

/** A dossier's reading for its header: parts done and counted, and the parts each chip and "what's next" name.
 *  `needsYou` holds the parts in Needs you; `yours` adds those in Verify or Ready to merge. */
interface Moving {
  parts: Part[]; done: number; count: number;
  needsYou: Part[]; yours: Part[]; decisions: Part[]; blockedSlices: { part: Part; slice: Slice }[];
  ready: Part[]; active: Part[]; fog: string[];
}

function moving(parent: Item, parts: Part[], unavailable: boolean): Moving {
  const ahead = parts.filter((p) => !isDone(p.item));
  return {
    parts,
    done: Math.max(parent.subIssues.completed, parts.length - ahead.length),
    count: Math.max(parent.subIssues.total, parts.length),
    needsYou: ahead.filter((p) => needsAnswer(p.item)),
    yours: ahead.filter((p) => YOURS.includes(p.item.status) && !workingAgain(p.item, unavailable)),
    decisions: ahead.filter((p) => DECISION_KINDS.includes(p.kind)),
    blockedSlices: ahead.flatMap((part) => part.item.slices.filter((s) => s.progress === 'blocked').map((slice) => ({ part, slice }))),
    ready: ahead.filter(startable),
    active: ahead.filter((p) => !needsAnswer(p.item) && (['Shaping', 'In progress', 'Review'].includes(p.item.status) || workingAgain(p.item, unavailable))),
    fog: parent.map?.fog ?? [],
  };
}

const kindLabel = (parent: Item) => (parent.kind === 'concept' ? 'Concept' : 'Coupled work');
const repos = (m: Moving, data: BoardData) => [...new Set(m.parts.map((p) => repoName(repoKey(p.item), data.repos)))].join(' + ');

/** Every part as a segment in its status colour, done first, so the bar fills left to right; a dashed one per part the board doesn't read. */
function PartsBar({ m }: { m: Moving }) {
  const order = [...m.parts].sort((a, b) => Number(isDone(b.item)) - Number(isDone(a.item)) || stageOf(b.item.status) - stageOf(a.item.status));
  const unread = m.count - m.parts.length;
  const unavailable = useActivityUnavailable();
  return (
    <ol className="m-0 flex min-w-0 list-none gap-[2px] p-0" title={`${m.done}/${m.count} parts done`} data-part-bar>
      {order.map((p) => {
        const { word, glyph } = shownStatus(p.item, unavailable);
        return (
          <li key={p.item.id} title={`${itemName(p.item)}: ${isDone(p.item) ? 'Complete' : word}`} className={`h-1.5 min-w-[3px] flex-1 rounded-full ${glyph === 'In progress' ? 'status-pulse' : ''}`}
            style={{ background: isDone(p.item) ? 'var(--st-done)' : glyph === 'Queued' || glyph === 'List' ? 'var(--soft)' : STATUS_COLOR[glyph] }} />
        );
      })}
      {Array.from({ length: Math.max(0, unread) }, (_, n) => <li key={`u${n}`} className="h-1.5 min-w-[3px] flex-1 rounded-full border border-dashed border-(--input)" />)}
    </ol>
  );
}

/** The one thing to say next: what waits on you (a part in Needs you first), else what can start, else what's moving. */
function nextOf(m: Moving, parent: Item): { tone: 'you' | 'start' | 'moving' | 'none'; part?: Part; text: string } {
  if (needsAnswer(parent)) return { tone: 'you', text: itemName(parent) };
  const yours = m.needsYou[0] ?? m.yours[0];
  if (yours) return { tone: 'you', part: yours, text: `${itemName(yours.item)}` };
  if (m.ready[0]) return { tone: 'start', part: m.ready[0], text: `${itemName(m.ready[0].item)}` };
  if (m.active[0]) return { tone: 'moving', part: m.active[0], text: `${itemName(m.active[0].item)}` };
  return { tone: 'none', text: m.count > m.parts.length ? 'Some parts are outside the board' : 'Nothing waits on you' };
}

/** Line 1's thread counts and Azure fields: they give up their room before the title does, ending in an ellipsis.
 *  Below `lg` they may shrink to nothing, so a narrow line's title keeps its room; their tooltips keep the text. */
const META = 'min-w-0 lg:min-w-10 shrink-[1000] truncate';

/** The dossier's T3 threads, then how many run and how many wait for the user's reply, each left out at zero (with no
 *  threads, nothing), so the threads' wording never contradicts the "need you" chip, which counts parts. */
function threadCounts(threads: ReturnType<typeof threadsOf>): string {
  if (!threads.length) return '';
  const running = threads.filter(threadAtWork).length;
  const waiting = threads.filter((t) => t.state === 'needs you').length;
  return [plural(threads.length, 'T3 thread'), running && `${running} running`, waiting && `${waiting} awaiting your reply`].filter(Boolean).join(' · ');
}

/** A small count chip: `n` and its word, coloured by `tone`, hidden at zero. */
function Count({ n, word, tone, icon }: { n: number; word: string; tone: 'warning' | 'danger' | 'neutral' | 'accent'; icon?: ReactNode }) {
  if (!n) return null;
  return <Badge tone={tone} className="tabular-nums whitespace-nowrap" data-chip>{icon}{n} {word}</Badge>;
}

/** What needs the user's eye: parts in Needs you, open decisions, blocked slices and the map's remaining fog. */
function Counts({ m }: { m: Moving }) {
  return <>
    <Count n={m.needsYou.length} word="need you" tone="warning" icon={<StatusGlyph status="Needs you" className="size-3" />} />
    <Count n={m.decisions.length} word={m.decisions.length === 1 ? 'decision' : 'decisions'} tone="accent" icon={<MessagesSquare />} />
    <Count n={m.blockedSlices.length} word="blocked" tone="danger" icon={<Ban />} />
    <Count n={m.fog.length} word="fog" tone="neutral" icon={<CircleHelp />} />
  </>;
}

/** The reason a concept's delivery record gives when no active build is left to deliver it. */
const NO_DELIVERY = 'No delivery planned.';

/** A concept whose Refinement is complete, which says nothing of its delivery unless none is planned, per ADR 0003. */
function Refined({ parent }: { parent: Item }) {
  if (!parent.refinement?.complete) return null;
  return <Badge tone="success" className="whitespace-nowrap" data-refined>Refined{parent.completion?.reasons.includes(NO_DELIVERY) && ' · no delivery planned'}</Badge>;
}

/** Next, as a sentence with its Start. */
function Next({ m, data, parent }: { m: Moving; data: BoardData; parent: Item }) {
  const n = nextOf(m, parent);
  // A part on your desk is named as its attention row names it: Needs you, or to verify or merge.
  const yours = n.part?.item.status === 'Verify' ? 'To verify' : n.part?.item.status === 'Ready to merge' ? 'To merge' : 'Needs you';
  const word = { you: yours, start: 'Next', moving: 'Moving', none: '' }[n.tone];
  return (
    <span className="flex min-w-0 items-center gap-2 text-[12px]">
      {word && <span className={`shrink-0 font-medium ${n.tone === 'you' ? 'text-(--warning-foreground)' : 'text-(--muted-foreground)'}`}>{word}</span>}
      <span className="min-w-0 truncate" title={n.text}>{n.text}</span>
      {n.part && n.tone === 'start' && <span className="shrink-0" onClick={stop}><PartStart part={n.part} data={data} label="Start" /></span>}
    </span>
  );
}

/** What the Work map can't draw: the concept's own question over it, what it depends on and doesn't know yet under it. */
const ABOVE_MAP = ['you'];
const BELOW_MAP = ['dependencies', 'fog'];

/** A dossier's one line, in the dock and over the opened dossier; `lead` sits before its source icon. */
function DossierLine({ parent, parts, data, lead, onClick, className = '' }: { parent: Item; parts: Part[]; data: BoardData; lead: ReactNode; onClick?: (e: MouseEvent<HTMLDivElement>) => void; className?: string }) {
  const isPicked = usePicked(parent);
  const m = moving(parent, parts, useActivityUnavailable());
  const threads = [parent, ...parts.map((p) => p.item)].flatMap(threadsOf);
  return (
    <div onClick={onClick} data-item={parent.id} title={threadCounts(threads) || undefined}
      className={`grid ${DOCK_COLUMNS} h-9 items-center gap-x-3 pl-1.5 pr-3 ${className} ${picked(isPicked)}`}>
      <span className="flex min-w-0 items-center gap-1.5" data-line="1">
        {lead}
        <SourceIcon item={parent} />
        <Badge tone="neutral" className="shrink-0">{kindLabel(parent)}</Badge>
        <button type="button" onClick={(e) => { e.stopPropagation(); open(parent); }} title={parent.title} data-title
          className="min-w-0 truncate rounded text-left text-[13px] font-medium hover:underline"><ItemTitle item={parent} /></button>
        <span className={`${META} empty:hidden`}><AzureFields azure={parent.azure} /></span>
        <span onClick={stop} className="ml-auto flex shrink-0 gap-1 pl-1" data-chips><Refined parent={parent} /><Counts m={m} /></span>
      </span>
      <span data-col="next" className="min-w-0" data-next><Next m={m} data={data} parent={parent} /></span>
      <span data-col="bar"><PartsBar m={m} /></span>
      <span data-col="count" className="text-right text-[11px] tabular-nums text-(--muted-foreground)" title={`${m.done}/${m.count} parts done`}>{m.done}/{m.count}</span>
      <span data-col="figures" className="hidden min-w-0 @4xl:grid"><Figures s={figuresOf(parent, data, true)} /></span>
      <span data-col="repos" className="hidden truncate text-right text-[11px] text-(--muted-foreground) @4xl:block" title={repos(m, data)}>{repos(m, data)}</span>
    </div>
  );
}

/** A dossier in the dock: only the title opens the item; anywhere else on the line but the chips opens the dossier. */
function DossierRow({ parent, parts, data, onOpen }: { parent: Item; parts: Part[]; data: BoardData; onOpen: () => void }) {
  // Letting go of a drag that selected text in the line leaves the board as it was; a key press on the chevron (a click
  // with no detail) or a selection elsewhere on the page still opens it.
  const opened = (e: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (e.detail > 0 && selection && !selection.isCollapsed && e.currentTarget.contains(selection.anchorNode)) return;
    onOpen();
  };
  const lead = (
    <button type="button" data-dossier-open aria-label={`Open ${itemName(parent)}`}
      className="grid size-6 shrink-0 place-items-center rounded-md text-(--muted-foreground) hover:bg-(--soft) hover:text-(--foreground)">
      <ChevronRight className="size-4" />
    </button>
  );
  return (
    <article className="border-b border-(--border) last:border-b-0" data-dossier={parent.id}>
      <DossierLine parent={parent} parts={parts} data={data} lead={lead} onClick={opened} className="cursor-pointer hover:bg-(--accent)" />
    </article>
  );
}

/** A concept or coupled parent, in full, in the board's workspace: its parts as a Work map or a list, with what keeps them moving. */
export function OpenDossier({ dossier: { parent, parts }, onBack }: { dossier: DossierItems; onBack: () => void }) {
  const { data } = useBoardStore();
  const [view, setView] = useView(parent);
  // A dialog or a menu takes Escape first: its layer marks the event in the capture phase, before this hears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !useItemDialogStore.getState().itemId) onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);
  const find: FindRef = (repo = parent.repo ?? '', n) => data.items.find((i) => i.number === n && i.repo?.toLowerCase() === repo.toLowerCase());
  const missing = Math.max(parent.subIssues.total, parts.length) - parts.length;
  const back = <Button {...kind('control')} data-dossier-back autoFocus onClick={onBack} title="Back to the board (Esc)" aria-keyshortcuts="Escape" className="shrink-0" leftIcon={<ArrowLeft />}>Back</Button>;
  return (
    <article data-stage="dossier" data-dossier={parent.id} aria-label={itemName(parent)} className="@container min-w-0 flex-1 rounded-xl border border-(--border) bg-(--card) shadow-xs">
      <header className="sticky top-0 z-10 rounded-t-xl border-b border-(--border) bg-(--card)">
        <DossierLine parent={parent} parts={parts} data={data} lead={back} />
      </header>
      <div className="grid gap-3 p-3">
        <div className="flex items-center gap-3">
          {missing > 0 && <p className="m-0 text-xs text-(--muted-foreground)" data-unread-parts>
            {plural(missing, 'part')} the board doesn't read. A repository may no longer be on the board.
          </p>}
          <span className="ml-auto shrink-0"><ViewToggle view={view} onView={setView} /></span>
        </div>
        <StructureSync item={parent} />
        {view === 'map'
          ? <>
            <Attention parent={parent} parts={parts} data={data} find={find} only={ABOVE_MAP} />
            <WorkMap parts={parts} check={parent.map?.check} data={data} home={repoKey(parent)} />
            <Attention parent={parent} parts={parts} data={data} find={find} only={BELOW_MAP} />
          </>
          : <>
            <Attention parent={parent} parts={parts} data={data} find={find} />
            <PartsList parts={parts} data={data} />
          </>}
      </div>
    </article>
  );
}

/** The dossiers the filters leave; a dossier follows its parent's row. With none, the dock takes no height. */
export function Dossiers({ dossiers, onOpen }: { dossiers: DossierItems[]; onOpen: (id: string) => void }) {
  const { data } = useBoardStore();
  if (!dossiers.length) return null;
  return (
    <Pane id="dock" title="Concepts and linked work" count={dossiers.length}>
      <div data-dossiers>{dossiers.map(({ parent, parts }) => <DossierRow key={parent.id} parent={parent} parts={parts} data={data} onOpen={() => onOpen(parent.id)} />)}</div>
    </Pane>
  );
}
