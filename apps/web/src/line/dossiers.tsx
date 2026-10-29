// The line's dossiers: each open concept, and each open item with sub-issues on the board, shown whole. A dossier's
// header has its parts done, repositories, T3 threads and agent total; then its map (destination, decisions so far,
// open questions and end-to-end check) beside its parts as a checklist, or the parts drawn as a map of what waits on
// what; then each part's row on the stage track, its done parts folded away.

import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, CircleHelp, FlaskConical, GitPullRequest, ListChecks, Map as MapIcon } from 'lucide-react';
import { carriesTwoStatuses, duration, formatTokens, formatUsd, itemTotal, kindOf, plural, prLabel, ref, repoKey, repoName } from '@lar-factory/shared';
import type { BoardData, Blocker, EndToEndCheck, Item, ItemThread } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { ICON, kind } from '../buttons/button-kinds.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { AzureFields, ItemTitle, RepoTag, SliceBar } from '../items/item-parts.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { StartAfterError } from '../items/start-after.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { ItemStatusGlyph, StatusGlyph } from '../items/status-glyph.tsx';
import { THREAD_GLYPH, dossiersOf, isDone, openWaits, threadsOf } from './dossier-parts.ts';
import type { Part } from './dossier-parts.ts';
import { PartStart } from './part-start.tsx';
import { AgentCell, GRID, OnYourDesk, Row, StageHeader, threadText, Track, YOURS, picked, statsOf } from './stage-track.tsx';
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

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">{children}</h3>;
}

type View = 'list' | 'map';

/** Checklist or map: one dossier's way of drawing its parts. */
function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
  const one = (v: View, icon: ReactNode, label: string) => (
    <button type="button" onClick={() => onView(v)} aria-pressed={view === v}
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs ${view === v ? 'bg-(--card) font-medium text-(--foreground) shadow-xs' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{icon}{label}</button>
  );
  return <div className="inline-flex rounded-lg bg-(--muted) p-0.5">{one('list', <ListChecks className="size-3.5" />, 'Checklist')}{one('map', <MapIcon className="size-3.5" />, 'Map')}</div>;
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

/** What the dossier is for, from its map: its destination, decisions so far, open questions and end-to-end check. */
function About({ parent, find }: { parent: Item; find: FindRef }) {
  const { map } = parent;
  if (!map) return <div className="grid content-start gap-5"><p className="m-0 text-(--muted-foreground)">No map yet. The parts come from the item's children.</p></div>;
  return (
    <div className="grid content-start gap-5" data-about>
      <section className="grid gap-1.5"><Heading>Destination</Heading><p className="m-0 leading-relaxed">{map.destination}</p></section>
      <section className="grid gap-1.5">
        <Heading>Decisions so far <span className="tabular-nums">{map.decisions.length}</span></Heading>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {map.decisions.map((d) => <li key={d} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-(--st-done)" /><span><Refs text={d} find={find} /></span></li>)}
        </ul>
      </section>
      <section className="grid gap-1.5">
        <Heading>Open questions <span className="tabular-nums">{map.fog.length}</span></Heading>
        {map.fog.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {map.fog.map((q) => <li key={q} className="flex gap-2"><CircleHelp className="mt-0.5 size-3.5 shrink-0 text-(--st-amber)" /><span><Refs text={q} find={find} /></span></li>)}
          </ul>
        ) : <p className="m-0 text-(--muted-foreground)">None. Every decision is made.</p>}
      </section>
      {map.check && (
        <section className="grid gap-1.5 rounded-lg border border-(--border) p-3" data-check>
          <Heading>End-to-end check</Heading>
          <span className="flex items-center gap-2 font-medium"><StatusGlyph status="Queued" /><span className="min-w-0 flex-1">{map.check.title}</span><span className="text-[11px] font-normal text-(--muted-foreground)">waiting</span></span>
          <ol className="m-0 grid gap-0.5 pl-9 text-[12px] text-(--muted-foreground)">{map.check.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
      )}
    </div>
  );
}

/** The header's side: the part that waits on you, else the first part that can start, else that nothing waits on you. */
function HeaderSide({ parts, data, missing }: { parts: Part[]; data: BoardData; missing: number }) {
  const yours = parts.find((p) => YOURS.includes(p.item.status));
  const startable = parts.find((p) => p.item.status === 'Ready' && !openWaits(p).length && !carriesTwoStatuses(p.item));
  if (yours) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); open(yours.item); }} className="inline-flex items-center gap-1 rounded px-1 text-(--warning-foreground) hover:bg-(--accent)">
        <StatusGlyph status={yours.item.status} className="size-3" />{ref(yours.item)} waits on you
      </button>
    );
  }
  if (startable) return <span className="shrink-0" onClick={stop}><PartStart part={startable} data={data} build={`Start ${ref(startable.item)}`} /></span>;
  if (missing) return <span>Some parts are outside the board</span>;
  return <span>Nothing waits on you</span>;
}

/** A concept or coupled parent, in full: what it's for and its parts as a checklist or a map, then their rows. */
function Dossier({ parent, parts, data, now }: { parent: Item; parts: Part[]; data: BoardData; now: number }) {
  const [view, setView] = useState<View>('list');
  const [showDone, setShowDone] = useState(false);
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
      <div onClick={() => open(parent)} data-item={parent.id} className={`${GRID} cursor-pointer border-b border-(--border) py-3 hover:bg-(--accent) ${picked(isPicked)}`}>
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 text-left">
          <span className="flex items-center gap-2 text-[11px] text-(--muted-foreground)">
            <span className="rounded border border-(--input) px-1.5 font-medium text-(--foreground)">{kindOf(parent) === 'concept' ? 'Concept' : 'Coupled work'}</span>
            <span className="truncate">{parent.status} · {completed}/{count} parts done · {names.join(' + ')}</span>
          </span>
          <span className="truncate text-base font-medium tracking-tight"><ItemTitle item={parent} /></span>
          <AzureFields azure={parent.azure} />
          <span className="truncate text-[11px] text-(--muted-foreground)">
            {plural(threads.length, 'T3 thread')} · {threads.filter((t) => t.state === 'running').length} running · {threads.filter((t) => t.state === 'needs you').length} need you
          </span>
        </span>
        <Track status={parent.status} />
        <AgentCell s={total && total !== 'unavailable' ? total : null} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-[11px] text-(--muted-foreground)"><HeaderSide parts={parts} data={data} missing={missing} /></div>
      </div>

      {missing > 0 && <p className="m-0 px-4 pt-3 text-xs text-(--muted-foreground)" data-unread-parts>
        {plural(missing, 'part')} the board doesn't read. A repository may no longer be on the board.
      </p>}
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <ViewToggle view={view} onView={setView} />
        <span className="text-[11px] text-(--muted-foreground)">{view === 'map' ? 'Lanes by repo; arrows show what waits on what' : 'Parts follow their dependencies, then the end-to-end check'}</span>
      </div>
      {view === 'map' ? (
        <div className="grid gap-5 p-4">
          <WorkMap parts={parts} check={check} data={data} now={now} />
          <About parent={parent} find={find} />
        </div>
      ) : (
        <div className="grid gap-6 p-4 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <About parent={parent} find={find} />
          <div className="grid content-start gap-3" data-checklist>
            <Heading>Parts, in order</Heading>
            {groups.map((group) => (
              <Phase key={group[0]!.item.id}
                title={group[0]!.kind === 'build' ? <>Build <RepoTag repo={group[0]!.item.repo!} repos={data.repos} /></> : 'Decide'}
                hint={group[0]!.kind === 'build' ? repoHint(group) : `${group.filter((p) => isDone(p.item)).length}/${group.length} answered`}
                parts={group} data={data} />
            ))}
            {check && <CheckPhase check={check} parent={parent} builds={builds} data={data} />}
          </div>
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
    </article>
  );
}

/** `items` are the line's items in the main area's scope. */
export function Dossiers({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  return dossiersOf(items, data.items).map(({ parent, parts }) => <Dossier key={parent.id} parent={parent} parts={parts} data={data} now={now} />);
}
