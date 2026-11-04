// The dock, Concepts and linked work: each started concept, and each open item with sub-issues on the board, as a row:
// its source, repository, kind and title with any other repositories, its most important chip (parts that need you, open
// decisions, blocked slices, whether it is refined, fog) in a stage row's state column, and its Start and an expanded row's
// view controls in the action slot, then a second line of its part bar, parts done, what's next and agent figures, in the
// columns the board's stage rows keep. Its chevron expands it in place under that same line, in the page's scroll, on its Work map,
// with the concept's own question above and its Dependencies and fog below. Its parts list instead lists what keeps the
// work moving (parts that need you, parts to verify or merge, open decisions, blocked slices, waiting parts, parts ready to
// start, Dependencies and fog) or says nothing holds it up, then each part with what it asks next, its stage track, figures,
// thread and slices, the done parts folded away. The browser remembers which dossiers are expanded and which view each shows.

import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Ban, Check, ChevronRight, CircleHelp, GitPullRequest, ListChecks, Map as MapIcon, MessagesSquare } from 'lucide-react';
import { UNREADABLE, needsAnswer, openQuestionThread, blockerGroups, blockerRef, canRetryBuild, currentBuildThread, plural, prLabel, itemName, ref, repoKey, repoName, workingAgain } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';
import { useBoardStore } from '../board/board-store.ts';
import { dependenciesOf } from '../items/dependencies.tsx';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { KeepClicks } from '../items/keep-clicks.tsx';
import { AzureFields, ItemTitle, RepoCell, SliceBar, StructureSync, shownStatus, useActivityUnavailable, usageLoading, usageUnreadable, useShownStatus } from '../items/item-parts.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { StartAfterError } from '../items/start-after.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { ItemStatusGlyph, StatusGlyph, STATUS_COLOR, useStatusActivity } from '../items/status-glyph.tsx';
import { DECISION_KINDS, THREAD_GLYPH, isDone, openWaits, partLabel, shownThread, threadAtWork, threadsOf } from './dossier-parts.ts';
import type { DossierItems, Part } from './dossier-parts.ts';
import { StartBuild } from '../items/start-build.tsx';
import { PartStart, startable } from './part-start.tsx';
import { Figures, ROW_ACTION, ROW_RULE, RowSecondLine, figuresOf, opensItem } from './columns.tsx';
import { Pane } from './pane.tsx';
import { OnYourDesk, ROW_OPENS, Track, lastSeen, stageOf, YOURS, picked } from './stage-track.tsx';
import { RowKind, RowSource } from './row-identity.tsx';
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
  const running = useStatusActivity();
  if (!thread) {
    const { work, dependencies } = blockerGroups(part.item, openWaits(part));
    const waits = [...work ? [work.names] : [], ...dependencies ? [`you to mark ${dependencies.names} met`] : []];
    return waits.length ? <span>Waiting on {waits.join(' and ')}</span> : null;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={thread.title}>
      <StatusGlyph status={thread.state === 'running' ? part.item.status : THREAD_GLYPH[thread.state]} running={!thread.observedAt && running(part.item)} className="size-3" />
      <span className="truncate">T3 · {thread.title}</span>
      <span className="shrink-0">· {thread.archived ? 'archived' : thread.state}{lastSeen(thread)}</span>
    </span>
  );
}

type View = 'list' | 'map';

/** A per-dossier setting this browser remembers. */
interface Stored<T> { name: string; read: (stored: string | null) => T; write: (value: T) => string }
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

/** Work map or parts list: one dossier's way of drawing its parts, as two small icon buttons named for assistive technology, in a group as tall as the row's line. */
function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
  const one = (v: View, icon: ReactNode, label: string) => (
    <button type="button" onClick={() => onView(v)} aria-pressed={view === v} title={label}
      className={`grid size-6 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-(--primary) ${view === v ? 'bg-(--card) text-(--foreground) shadow-xs' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{icon}<span className="sr-only">{label}</span></button>
  );
  return <div className="inline-flex rounded-lg bg-(--muted) p-0.5">{one('map', <MapIcon className="size-3.5" />, 'Work map')}{one('list', <ListChecks className="size-3.5" />, 'Parts list')}</div>;
}

/** Where the concept's planning lives, as a quiet label; hovering or focusing it reads the whole note. */
function LocalPlanning({ item }: { item: Item }) {
  if (!item.sync || item.sync.state === 'saved') return null;
  const note = ['Planning is saved on this Mac.', item.sync.message].filter(Boolean).join(' ');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} role={item.sync.state === 'error' || item.sync.state === 'conflict' ? 'status' : 'note'} aria-label={note} data-structure-sync
          className="whitespace-nowrap rounded text-(--muted-foreground) focus-visible:outline-2 focus-visible:outline-(--primary)">On this Mac</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{note}</TooltipPopup>
    </Tooltip>
  );
}

/** A part's source, status and title, up to two lines. */
function PartName({ part }: { part: Part }) {
  return (
    <span className="flex min-w-0 items-start gap-1.5 text-sm">
      <SourceIcon item={part.item} />
      <span className="mt-0.5 inline-flex"><ItemStatusGlyph item={part.item} className="size-3.5" /></span>
      <span className="line-clamp-2"><ItemTitle item={part.item} /></span>
    </span>
  );
}

/** A part as a link to its item dialog. */
function PartLink({ part }: { part: Part }) {
  return (
    <button type="button" onClick={() => open(part.item)} title={itemName(part.item)} className={`min-w-0 rounded text-left hover:underline ${ROW_OPENS}`}>
      <PartName part={part} />
    </button>
  );
}

/** One entry of an attention row, with what it waits on or its next action at the right. */
function Entry({ main, side }: { main: ReactNode; side?: ReactNode }) {
  return (
    <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1.5 hover:bg-(--soft)">
      <span className="min-w-0 flex-1 basis-64">{main}</span>
      {side && <span className="ml-auto shrink-0 text-xs text-(--muted-foreground)">{side}</span>}
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
        <Entry key={p.item.id} main={<PartLink part={p} />} side={<PartStart part={p} data={data} label="Start" />} />
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
          <dt className={`whitespace-nowrap pt-2 text-[11px] font-medium uppercase tracking-wide ${r.tone}`}>{r.label} <span className="tabular-nums">{r.entries.length}</span></dt>
          <dd className="m-0 grid gap-1">{r.entries}</dd>
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
  if (!done && working) return <OpenThread item={part.item} data={data} threadId={currentBuildThread(part.item)?.id} />;
  if (!done && YOURS.includes(status)) return <OnYourDesk />;
  if (!done && (status === 'Ready' || status === 'Queued')) return <PartStart part={part} data={data} label="Start" />;
  const waiting = !done && openWaits(part).length > 0;
  if (!done && !waiting && canRetryBuild(part.item)) return <StartBuild item={part.item} data={data} />;
  const thread = threadsOf(part.item).length > 0 || (!done && !waiting && ['Shaping', 'In progress', 'Review'].includes(status));
  return <>
    {waiting && <span className="max-w-48 truncate" title={waitsOn(part)}>{waitsOn(part)}</span>}
    {thread && <OpenThread item={part.item} data={data} />}
  </>;
}

/** One part of the parts list: one button opens its details from its title, stage track, status and Azure fields; what
 *  it asks next sits beside that button, then a second line of its slice bar and count, thread, PR and agent figures, and
 *  its start's message or error under that. `home` is the dossier's own repository, which needs no naming. */
function PartRow({ part, data, home }: { part: Part; data: BoardData; home: string }) {
  const { item } = part;
  const isPicked = usePicked(item);
  const waits = openWaits(part);
  const shown = useShownStatus(item);
  const running = useStatusActivity();
  const s = figuresOf(item, data);
  const slices = item.slices.length;
  const hasThreadLine = !!shownThread(part, shown.working) || waits.length > 0;
  return (
    <li data-part={item.id} className={`@container rounded-md px-3 py-2 hover:bg-(--accent) ${picked(isPicked)}`}>
      <div className="flex items-start gap-x-3">
        <button type="button" data-row-open onClick={() => open(item)} title={itemName(item)} className={`grid min-w-0 flex-1 gap-y-1 rounded text-left ${ROW_OPENS}`}>
          <PartName part={part} />
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-xs text-(--muted-foreground)" data-part-meta>
            <PartKindLabel kind={part.kind} />
            {repoKey(item) !== home && <RepoCell item={item} />}
            <span className="w-28 shrink-0"><Track status={isDone(item) ? 'Done' : item.status} running={running(item)} label={shown.word} waiting={waits.length > 0} /></span>
            <span>{isDone(item) ? 'Complete' : shown.word}</span>
            <AzureFields azure={item.azure} />
          </span>
        </button>
        <span data-part-action className="flex min-h-7 shrink-0 items-center justify-end gap-2 text-xs text-(--muted-foreground)"><Action part={part} data={data} /></span>
      </div>
      {(slices > 0 || item.linkedPrs.length > 0 || s || usageLoading(item, data) || usageUnreadable(item) || hasThreadLine) && (
        <RowSecondLine onClick={opensItem(item)} prs={item.linkedPrs} figures={s || usageLoading(item, data) ? <Figures s={s} item={item} /> : usageUnreadable(item) && UNREADABLE}
          bar={slices > 0 && <SliceBar item={item} />}
          count={slices > 0 && <span data-col="count" className="tabular-nums">{item.slices.filter((x) => x.progress === 'done').length}/{slices} slices</span>}>
          {hasThreadLine && <ThreadLine part={part} />}
        </RowSecondLine>
      )}
      {!isDone(item) && ['Ready', 'Queued', 'In progress'].includes(item.status) && (
        <span className="block pt-1 pl-5 empty:hidden"><StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} /><StartAfterError item={item} data={data} /></span>
      )}
    </li>
  );
}

/** The parts list: one row per open part in two columns where there's room, the done ones folded into a count. */
function PartsList({ parts, data, home }: { parts: Part[]; data: BoardData; home: string }) {
  const [showDone, setShowDone] = useState(false);
  const shown = parts.filter((p) => showDone || !isDone(p.item));
  const done = parts.filter((p) => isDone(p.item)).length;
  return (
    <div className="grid gap-1">
      <ol className="m-0 grid list-none gap-x-4 gap-y-1 p-0 @4xl:grid-cols-2" data-parts-list>
        {shown.map((p) => <PartRow key={p.item.id} part={p} data={data} home={home} />)}
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

/** The repositories the parts work in beyond the dossier's own, which its row already names. */
const otherRepos = (parent: Item, m: Moving, data: BoardData) => [...new Set(m.parts.filter((p) => repoKey(p.item) !== repoKey(parent)).map((p) => repoName(repoKey(p.item), data.repos)))].map((name) => `+ ${name}`).join(' ');

/** Every part as a segment in its status colour, done first, so the bar fills left to right; a dashed one per part the board doesn't read. */
function PartsBar({ m }: { m: Moving }) {
  const order = [...m.parts].sort((a, b) => Number(isDone(b.item)) - Number(isDone(a.item)) || stageOf(b.item.status) - stageOf(a.item.status));
  const unread = m.count - m.parts.length;
  const unavailable = useActivityUnavailable();
  return (
    <ol className="m-0 flex min-w-0 list-none gap-[2px] overflow-hidden p-0" title={`${m.done}/${m.count} parts done`} data-part-bar>
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
  if (m.count > m.parts.length) return { tone: 'none', text: 'Some parts are outside the board' };
  return { tone: 'none', text: noDelivery(parent) ? 'No delivery planned' : 'Nothing waits on you' };
}

/** Line 1's Azure fields: they give up their room before the title does, ending in an ellipsis.
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

/** The reason a concept's delivery record gives when no active build is left to deliver it. */
const NO_DELIVERY = 'No delivery planned.';

interface Chip { words: string; tone: 'warning' | 'danger' | 'neutral' | 'accent' | 'success'; icon?: ReactNode; refined?: boolean }

const noDelivery = (parent: Item) => Boolean(parent.refinement?.complete && parent.completion?.reasons.includes(NO_DELIVERY));

/** The dossier's chips, most important first, each left out at zero: what asks the user to act (parts in Needs you, open
 *  decisions, blocked slices), then a complete Refinement, which says nothing of delivery unless none is planned, per
 *  ADR 0003, then the map's remaining fog. */
function chipsOf(parent: Item, m: Moving): Chip[] {
  const count = (n: number, word: string, tone: Chip['tone'], icon: ReactNode): Chip[] => n ? [{ words: `${n} ${word}`, tone, icon }] : [];
  return [
    ...count(m.needsYou.length, 'need you', 'warning', <StatusGlyph status="Needs you" className="size-3" />),
    ...count(m.decisions.length, m.decisions.length === 1 ? 'decision' : 'decisions', 'accent', <MessagesSquare />),
    ...count(m.blockedSlices.length, 'blocked', 'danger', <Ban />),
    ...(parent.refinement?.complete ? [{ words: 'Refined', tone: 'success' as const, refined: true }] : []),
    ...(noDelivery(parent) ? [{ words: 'no delivery planned', tone: 'neutral' as const }] : []),
    ...count(m.fog.length, 'fog', 'neutral', <CircleHelp />),
  ];
}

/** The first chip whole, at its full width, and how many more the row's tooltip names. An empty dossier takes no room. */
function Chips({ chips }: { chips: Chip[] }) {
  const [first, ...rest] = chips;
  if (!first) return null;
  return (
    <span onClick={stop} className="flex shrink-0 items-center gap-1" data-chips>
      <Badge tone={first.tone} className="tabular-nums whitespace-nowrap" data-chip data-refined={first.refined || undefined}>{first.icon}{first.words}</Badge>
      {rest.length > 0 && <span className="tabular-nums text-(--muted-foreground)" data-chips-more>
        <span aria-hidden="true">+{rest.length}</span><span className="sr-only">{rest.map((c) => c.words).join(', ')}</span>
      </span>}
    </span>
  );
}

/** The row's tooltip: every chip's words, so one that doesn't show still reads, then the thread counts. */
const rowTooltip = (chips: Chip[], threads: ReturnType<typeof threadsOf>) =>
  [...chips.map((c) => c.words), threadCounts(threads)].filter(Boolean).join(' · ') || undefined;

/** Next, as a sentence. */
function Next({ n, badged }: { n: ReturnType<typeof nextOf>; badged: boolean }) {
  // A part on your desk is named as its attention row names it: Needs you, or to verify or merge.
  const yours = n.part?.item.status === 'Verify' ? 'To verify' : n.part?.item.status === 'Ready to merge' ? 'To merge' : 'Needs you';
  const word = { you: yours, start: 'Next', moving: 'Moving', none: '' }[n.tone];
  const unseen = n.tone === 'start' || (badged && word === 'Needs you');
  return (
    <span className="flex min-w-0 items-center gap-2">
      {/* Start sits in the action slot labelled "Start", and a "need you" badge says Needs you, so those words are screen-reader text and leave their room to the title. */}
      {word && <span className={`shrink-0 font-medium ${n.tone === 'you' ? 'text-(--warning-foreground)' : 'text-(--muted-foreground)'} ${unseen ? 'sr-only' : ''}`}>{word}</span>}
      <span className="min-w-0 truncate" title={n.text}>{n.text}</span>
    </span>
  );
}

/** What the Work map can't draw: the concept's own question over it, what it depends on and doesn't know yet under it. */
const ABOVE_MAP = ['you'];
const BELOW_MAP = ['dependencies', 'fog'];

/** A dossier's one line in the dock; `lead` takes the glyph's column of a stage row, `note` follows its title, and `tools`, an expanded dossier's view controls, sit in the action slot beside any Start. */
function DossierLine({ parent, parts, data, lead, note, tools, onClick, className = '' }: { parent: Item; parts: Part[]; data: BoardData; lead: ReactNode; note?: ReactNode; tools?: ReactNode; onClick?: (e: MouseEvent<HTMLDivElement>) => void; className?: string }) {
  const isPicked = usePicked(parent);
  const m = moving(parent, parts, useActivityUnavailable());
  const threads = [parent, ...parts.map((p) => p.item)].flatMap(threadsOf);
  const chips = chipsOf(parent, m);
  const n = nextOf(m, parent);
  const repos = otherRepos(parent, m, data);
  return (
    <div onClick={onClick} data-item={parent.id} title={rowTooltip(chips, threads)} className={`py-2 ${className} ${picked(isPicked)}`}>
      <div className="row-first">
        <div className="row-cols">
          {lead}
          <RowSource item={parent} />
          <span className="flex min-w-0 items-center" data-kind>{parent.kind === 'concept' ? <RowKind item={parent} /> : <Badge tone="neutral">Coupled work</Badge>}</span>
          <span className="flex min-w-0 items-center gap-1.5" data-line="1" data-title-cell>
            <button type="button" onClick={(e) => { e.stopPropagation(); open(parent); }} title={parent.title} data-title
              className={`min-w-0 truncate rounded text-left text-sm leading-7 font-medium text-(--foreground) hover:underline ${ROW_OPENS}`}><ItemTitle item={parent} /></button>
            <span className={`${META} empty:hidden`}><AzureFields azure={parent.azure} /></span>
            <span onClick={stop} className="flex shrink-0 items-center pl-1 empty:hidden">{note}</span>
            <span data-col="repos" className="min-w-16 shrink-[100] truncate text-(--muted-foreground) empty:hidden" title={repos || undefined}>{repos}</span>
          </span>
          {/* The first chip keeps its full width; the rest of the chips wait in the tooltip. */}
          <span className="flex min-w-0 items-center gap-1.5" data-col="state"><Chips chips={chips} /></span>
        </div>
        <span data-col="side" className="row-side">
          {/* A click beside the controls toggles the row, as anywhere else on it. */}
          <KeepClicks as="span" passEmpty className={ROW_ACTION}>
            {tools && <span className="flex shrink-0 items-center" data-dossier-tools>{tools}</span>}
            {n.part && n.tone === 'start' && <PartStart part={n.part} data={data} label="Start" />}
          </KeepClicks>
        </span>
      </div>
      <RowSecondLine bar={<PartsBar m={m} />} figures={<Figures s={figuresOf(parent, data, true)} item={parent} total />}
        count={<span data-col="count" className="tabular-nums" title={`${m.done}/${m.count} parts done`}>{m.done}/{m.count} parts</span>}>
        <span className="min-w-0" data-next><Next n={n} badged={m.needsYou.length > 0} /></span>
      </RowSecondLine>
    </div>
  );
}

/** What an expanded dossier holds, at its natural height: its parts as a Work map or a list, with what keeps them moving. */
function DossierBody({ parent, parts, data, view }: { parent: Item; parts: Part[]; data: BoardData; view: View }) {
  const find: FindRef = (repo = parent.repo ?? '', n) => data.items.find((i) => i.number === n && i.repo?.toLowerCase() === repo.toLowerCase());
  const missing = Math.max(parent.subIssues.total, parts.length) - parts.length;
  // The line's own label says the planning is local; a spec waiting to save still speaks up here.
  const { sync: _, ...unsynced } = parent;
  return (
    <div className="grid gap-3 border-t border-(--border) p-3" data-dossier-body>
      {noDelivery(parent) && <p className="m-0 text-xs text-(--muted-foreground)" data-no-delivery>{NO_DELIVERY}</p>}
      {missing > 0 && <p className="m-0 text-xs text-(--muted-foreground)" data-unread-parts>
        {plural(missing, 'part')} the board doesn't read. A repository may no longer be on the board.
      </p>}
      <StructureSync item={unsynced} />
      {view === 'map'
        ? <>
          <Attention parent={parent} parts={parts} data={data} find={find} only={ABOVE_MAP} />
          <WorkMap parts={parts} check={parent.map?.check} data={data} home={repoKey(parent)} />
          <Attention parent={parent} parts={parts} data={data} find={find} only={BELOW_MAP} />
        </>
        : <>
          <Attention parent={parent} parts={parts} data={data} find={find} />
          <PartsList parts={parts} data={data} home={repoKey(parent)} />
        </>}
    </div>
  );
}

/** A dossier in the dock: the title opens the item; the chevron, or anywhere else on the line but its controls, expands it in place. */
function DossierRow({ parent, parts, data }: { parent: Item; parts: Part[]; data: BoardData }) {
  const [on, setOn] = useStored(OPEN, parent);
  const [view, setView] = useStored(VIEW, parent);
  // Letting go of a drag that selected text in the line leaves it as it was; a selection elsewhere on the page still toggles it.
  const toggle = (e: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && e.currentTarget.contains(selection.anchorNode)) return;
    setOn(!on);
  };
  const lead = (
    <button type="button" data-dossier-open aria-expanded={on} aria-label={`${on ? 'Collapse' : 'Expand'} ${itemName(parent)}`} onClick={(e) => { stop(e); setOn(!on); }}
      className={`grid size-6 shrink-0 place-items-center rounded-md text-(--muted-foreground) hover:bg-(--soft) hover:text-(--foreground) ${ROW_OPENS}`}>
      <ChevronRight className={`size-4 ${on ? 'rotate-90' : ''}`} />
    </button>
  );
  return (
    <article className={`@container ${ROW_RULE}`} data-dossier={parent.id} aria-label={itemName(parent)}>
      <DossierLine parent={parent} parts={parts} data={data} lead={lead} onClick={toggle} className="cursor-pointer hover:bg-(--accent)"
        note={on && <LocalPlanning item={parent} />} tools={on && <ViewToggle view={view} onView={setView} />} />
      {on && <DossierBody parent={parent} parts={parts} data={data} view={view} />}
    </article>
  );
}

/** The dossiers the filters leave; a dossier follows its parent's row. With none, the dock takes no height. */
export function Dossiers({ dossiers }: { dossiers: DossierItems[] }) {
  const data = useBoardStore((state) => state.data);
  if (!dossiers.length) return null;
  return (
    <Pane id="dock" title="Concepts and linked work" count={dossiers.length}>
      <div data-dossiers>{dossiers.map(({ parent, parts }) => <DossierRow key={parent.id} parent={parent} parts={parts} data={data} />)}</div>
    </Pane>
  );
}
