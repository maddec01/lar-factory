// PROTOTYPE, throwaway. Line variant C, "Progress table + concept dossier": the line as rows down the page, one per
// piece of work, with the stations folded into six stages (Refining, Ready, Building, Review, Verify, Done) on a
// narrow track whose columns line up across every row, so progress reads like a Gantt chart; the thread and the next
// action sit on the right. Concepts and coupled work open on top as dossiers that take real room: destination,
// decisions and open questions beside a checklist of their parts in order (decisions, builds per repo, the
// end-to-end check), each with what it waits on, its T3 thread and its next action; their own rows nest beneath on
// the same track.

import type { ReactNode } from 'react';
import { Check, CircleHelp, FlaskConical, GitPullRequest } from 'lucide-react';
import { duration, formatUsd, platformOf, prLabel, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { Button as UiButton } from '@mux-factory/ui/button';
import { PlatformTag, STATUS_COLOR, StatusGlyph, platformColor } from '../chrome.tsx';
import type { Pick } from '../list-sidebar.tsx';
import { ItemTitle, SliceBar, refText, statsOf } from '../item-bits.tsx';
import { CONCEPTS } from './line-data.ts';
import type { LineProps } from './line-data.ts';

export const NAME = 'Progress table + concept dossier';

const STAGES: { name: string; short: string; statuses: Status[] }[] = [
  { name: 'Refining', short: 'Refine', statuses: ['Queued', 'Shaping', 'Needs you'] },
  { name: 'Ready', short: 'Ready', statuses: ['Ready'] },
  { name: 'Building', short: 'Build', statuses: ['In progress'] },
  { name: 'Review', short: 'Review', statuses: ['Review'] },
  { name: 'Verify', short: 'Verify', statuses: ['Verify', 'Ready to merge'] },
  { name: 'Done', short: 'Done', statuses: ['Done'] },
];
const stageOf = (s: Status) => STAGES.findIndex((st) => st.statuses.includes(s));
/** One grid for every row, in the table and in each dossier, so the stage columns line up down the page. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_15rem_10rem] items-center gap-x-4 px-3 @3xl:grid-cols-[minmax(0,1fr)_21rem_14rem]';
const picked = (on: boolean) => (on ? 'bg-(--accent) ring-2 ring-inset ring-(--primary)' : '');
const PAST = 'color-mix(in srgb, var(--foreground) 28%, transparent)';

type Concept = (typeof CONCEPTS)[number];
type Kind = Concept['tasks'][number]['kind'];
type Thread = Concept['threads'][number];
const KINDS: Kind[] = ['research', 'grill', 'prototype', 'build', 'end-to-end'];
/** A thread's state as the status glyph that already means it. */
const THREAD_GLYPH: Record<Thread['state'], Status> = { running: 'In progress', 'needs you': 'Needs you', done: 'Done', 'not started': 'Queued' };
const E2E_GLYPH: Record<Concept['endToEnd']['state'], Status> = { waiting: 'Queued', running: 'In progress', passed: 'Done', failed: 'Needs you' };

interface Part { issue: number; kind: Kind; repo: string; waitsOn: number[]; item: Item | undefined; thread: Thread | undefined }

const kindOf = (i: Item): Kind => (KINDS.find((k) => i.labels.includes(`decision: ${k}`)) ?? 'build');
const childOf = (c: Item, p: Item) => c.parent?.number === p.number && c.parent.repo === p.repo;
const findIn = (data: BoardData, n: number, repo?: string) => data.items.find((i) => i.number === n && (!repo || i.repo === repo)) ?? data.items.find((i) => i.number === n);

/** A parent's parts in the order they run: decisions, then builds, then anything else; from the mock when it has one. */
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

/** The one thing each status asks next, as a mock button. */
function nextAction(status: Status, waiting: boolean): { label: string; primary?: boolean; disabled?: boolean } | null {
  switch (status) {
    case 'Queued': return { label: 'Refine', primary: !waiting, disabled: waiting };
    case 'Needs you': return { label: 'Answer', primary: true };
    case 'Ready': return { label: 'Start build', primary: !waiting, disabled: waiting };
    case 'Shaping': case 'In progress': case 'Review': return { label: 'Open thread' };
    case 'Verify': return { label: 'Verify', primary: true };
    case 'Ready to merge': return { label: 'Merge', primary: true };
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

/** A thread's state from the item's status, for work the mock has no thread for. */
const THREAD_TEXT: Partial<Record<Status, string>> = {
  Queued: 'no thread yet', Shaping: 'shaping thread running', 'Needs you': 'thread waits on you', Ready: 'build starts on Start',
  'In progress': 'build thread running', Review: 'reviewers running', Verify: 'build waits on you', 'Ready to merge': 'approved, you merge',
};

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
      <span className="truncate text-right">{side}</span>
    </div>
  );
}

/** One piece of work on the track; the whole row opens it. */
function Row({ item, data, now, pick, side, waiting, nested }: { item: Item; data: BoardData; now: number; pick: Pick; side: ReactNode; waiting?: boolean; nested?: boolean }) {
  const done = item.slices.filter((s) => s.progress === 'done').length;
  return (
    <div onClick={() => pick.set(item.id)} className={`${GRID} cursor-pointer border-b border-(--border) py-2 last:border-b-0 hover:bg-(--accent) ${picked(pick.id === item.id)}`}>
      <button type="button" title={`${refText(item)} ${item.title}`} className="flex min-w-0 items-start gap-2 text-left">
        {nested && <span className="mb-auto ml-1 h-3 w-2.5 shrink-0 rounded-bl border-b border-l border-(--input)" />}
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: platformColor(platformOf(item, data.repos)) }} />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="truncate text-[13px]"><ItemTitle item={item} /></span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--muted-foreground)">
            <span className="truncate">{item.status} · {platformOf(item, data.repos)} · {shortAgo(item.updatedAt, now)}{item.slices.length > 0 && ` · ${done}/${item.slices.length} slices`}</span>
            {item.blockedBy > 0 && <span className="shrink-0 rounded bg-(--error-surface) px-1 text-(--error-foreground)">blocked by {item.blockedBy}</span>}
          </span>
          {item.slices.length > 0 && <span className="max-w-60"><SliceBar item={item} /></span>}
        </span>
      </button>
      <Track status={item.status} waiting={waiting} />
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-[11px] text-(--muted-foreground)">{side}</div>
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

/** One step of the checklist: the part, what it waits on, its thread, and the next action. */
function Step({ part, data, pick }: { part: Part; data: BoardData; pick: Pick }) {
  const { item } = part;
  const waits = openWaits(part, data);
  const next = item && nextAction(item.status, waits.length > 0);
  return (
    <li onClick={() => item && pick.set(item.id)} className={`grid cursor-pointer gap-1 rounded-md px-2 py-1.5 hover:bg-(--accent) ${picked(!!item && pick.id === item.id)}`}>
      <span className="flex min-w-0 items-center gap-2">
        <StatusGlyph status={item?.status ?? 'Queued'} />
        <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px]">{item ? <ItemTitle item={item} /> : `#${part.issue}`}</button>
        <span className="shrink-0 rounded border border-(--border) px-1 text-[10px] text-(--muted-foreground)">{part.kind}</span>
        {next && <Act {...next} />}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5.5 text-[11px] text-(--muted-foreground)">
        <span>{item?.status ?? 'not on the board'}</span>
        {part.waitsOn.length > 0 && <span className="inline-flex flex-wrap items-center gap-1">{item && stageOf(item.status) > 1 ? 'after' : 'waits on'} <WaitChips waitsOn={part.waitsOn} data={data} pick={pick} /></span>}
        {item?.linkedPrs.map((pr) => <span key={pr.number} className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(pr)}</span>)}
      </span>
      <span className="min-w-0 pl-5.5 text-[11px] text-(--muted-foreground)"><ThreadLine thread={part.thread} waits={waits} /></span>
    </li>
  );
}

function Phase({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-1">
      <h4 className="m-0 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">{title}{hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}</h4>
      <ol className="m-0 grid list-none gap-0.5 p-0">{children}</ol>
    </section>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">{children}</h3>;
}

/** A concept or coupled parent, in full: the map on the left, the parts in order on the right, their rows below. */
function Dossier({ parent, parts, data, now, pick }: { parent: Item; parts: Part[]; data: BoardData; now: number; pick: Pick }) {
  const concept = parent.number !== null ? CONCEPTS[parent.number] : undefined;
  const find = (n: number) => parts.find((p) => p.issue === n)?.item ?? findIn(data, n, parent.repo ?? undefined);
  const decisions = parts.filter((p) => p.kind !== 'build' && p.kind !== 'end-to-end');
  const builds = parts.filter((p) => p.kind === 'build');
  const repos = [...new Set(builds.map((p) => p.repo))];
  const platformName = (repo: string) => data.repos.find((r) => r.repo === repo)?.platform ?? repo.split('/')[1] ?? repo;
  /** The other repos whose builds a repo's builds wait on. */
  const after = (repo: string) => [...new Set(builds.filter((b) => b.repo === repo).flatMap((b) => b.waitsOn)
    .flatMap((n) => builds.filter((o) => o.issue === n && o.repo !== repo).map((o) => o.repo)))];
  const repoHint = (repo: string) => repos.length < 2 ? undefined
    : after(repo).length ? `after ${after(repo).map(platformName).join(', ')}` : repos.some((r) => after(r).includes(repo)) ? 'goes first' : 'runs in parallel';
  const platforms = [...new Set(parts.map((p) => (p.item ? platformOf(p.item, data.repos) : null)).filter((p) => p !== null))];
  const items = parts.flatMap((p) => (p.item ? [p.item] : []));
  const done = items.filter((i) => i.status === 'Done').length;
  const e2e = concept?.endToEnd;
  const buildsDone = builds.every((b) => b.item?.status === 'Done');
  const spent = [parent, ...items].reduce((t, i) => t + (statsOf(i)?.costUsd ?? 0), 0);
  const agent = [parent, ...items].reduce((t, i) => t + (statsOf(i)?.agentMs ?? 0), 0);
  const threads = concept?.threads ?? [];
  const yours = parts.find((p) => p.item?.status === 'Needs you' || p.item?.status === 'Verify' || p.item?.status === 'Ready to merge')
    ?? parts.find((p) => p.item && (p.item.status === 'Ready' || p.item.status === 'Queued') && !openWaits(p, data).length);
  const yourNext = yours?.item && nextAction(yours.item.status, false);
  const isConcept = parent.labels.includes('concept');
  return (
    <article className="overflow-hidden rounded-xl border border-(--border) bg-(--card)">
      <div onClick={() => pick.set(parent.id)} className={`${GRID} cursor-pointer border-b border-(--border) py-3 hover:bg-(--accent) ${picked(pick.id === parent.id)}`}>
        <button type="button" className="grid min-w-0 gap-1 text-left">
          <span className="flex items-center gap-2 text-[11px] text-(--muted-foreground)">
            <span className="rounded border border-(--input) px-1.5 font-medium text-(--foreground)">{isConcept ? 'Concept' : 'Coupled work'}</span>
            <span className="truncate">{parent.status} · {done}/{items.length} parts done · {platforms.join(' + ')}</span>
          </span>
          <span className="truncate text-base font-medium tracking-tight"><ItemTitle item={parent} /></span>
          <span className="truncate text-[11px] text-(--muted-foreground)">
            {threads.length} T3 threads · {threads.filter((t) => t.state === 'running').length} running · {threads.filter((t) => t.state === 'needs you').length} need you
            {agent > 0 && ` · ${duration(agent)} agent time · ${formatUsd(spent)}`}
          </span>
        </button>
        <Track status={parent.status} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-[11px] text-(--muted-foreground)">
          {yours?.item && yourNext ? <><span>Next for you</span><Act label={`${yourNext.label} ${refText(yours.item)}`} primary /></>
            : e2e?.state === 'running' ? <span>Agents are running the end-to-end check</span> : <span>Nothing waits on you</span>}
        </div>
      </div>

      <div className="grid gap-6 p-4 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
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
          ) : <p className="m-0 text-(--muted-foreground)">No map yet: the parts below come from GitHub's sub-issues.</p>}
          {e2e && (
            <section className="grid gap-1.5 rounded-lg border border-(--border) p-3">
              <Heading>End-to-end check</Heading>
              <span className="flex items-center gap-2 font-medium"><StatusGlyph status={E2E_GLYPH[e2e.state]} /><span className="min-w-0 flex-1">{e2e.title}</span><span className="text-[11px] font-normal text-(--muted-foreground)">{e2e.state}</span></span>
              <ol className="m-0 grid gap-0.5 pl-9 text-[12px] text-(--muted-foreground)">{e2e.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>
          )}
        </div>

        <div className="grid content-start gap-3">
          <Heading>Parts, in order</Heading>
          {decisions.length > 0 && (
            <Phase title="Decide" hint={`${decisions.filter((p) => p.item?.status === 'Done').length}/${decisions.length} answered`}>
              {decisions.map((p) => <Step key={p.issue} part={p} data={data} pick={pick} />)}
            </Phase>
          )}
          {repos.map((repo) => {
            const here = builds.filter((b) => b.repo === repo);
            return (
              <Phase key={repo} title={<>Build <PlatformTag platform={platformName(repo)} /></>} hint={repoHint(repo)}>
                {here.map((p) => <Step key={p.issue} part={p} data={data} pick={pick} />)}
              </Phase>
            );
          })}
          {e2e && (
            <Phase title="Check" hint="the agents run it once every build lands">
              <li onClick={() => pick.set(parent.id)} className="grid cursor-pointer gap-1 rounded-md px-2 py-1.5 hover:bg-(--accent)">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusGlyph status={E2E_GLYPH[e2e.state]} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{e2e.title}</span>
                  <span className="shrink-0 rounded border border-(--border) px-1 text-[10px] text-(--muted-foreground)"><FlaskConical className="inline size-3" /> end-to-end</span>
                  {e2e.state === 'waiting' && <Act label="Run end-to-end" primary={buildsDone} disabled={!buildsDone} />}
                  {e2e.state === 'running' && <Act label="Watch run" />}
                  {e2e.state === 'failed' && <Act label="Open failure" primary />}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5.5 text-[11px] text-(--muted-foreground)">
                  <span>{e2e.state}</span>
                  {builds.length > 0 && <span className="inline-flex flex-wrap items-center gap-1">waits on <WaitChips waitsOn={builds.map((b) => b.issue)} data={data} pick={pick} /></span>}
                </span>
                <span className="pl-5.5 text-[11px] text-(--muted-foreground)">
                  <ThreadLine thread={threads.find((t) => t.issue === parent.number)} waits={buildsDone ? [] : builds.filter((b) => b.item?.status !== 'Done').map((b) => b.issue)} />
                </span>
              </li>
            </Phase>
          )}
        </div>
      </div>

      <div className="border-t border-(--border)">
        <StageHeader label={`Progress · ${items.length} parts`} side="Waits on · PR" />
        {parts.map((p) => p.item && (
          <Row key={p.issue} item={p.item} data={data} now={now} pick={pick} nested waiting={openWaits(p, data).length > 0}
            side={<PartSide part={p} data={data} pick={pick} />} />
        ))}
      </div>
    </article>
  );
}

function PartSide({ part, data, pick }: { part: Part; data: BoardData; pick: Pick }) {
  const waits = openWaits(part, data);
  if (waits.length) return <span className="inline-flex items-center gap-1">waits on <WaitChips waitsOn={waits} data={data} pick={pick} /></span>;
  const pr = part.item?.linkedPrs[0];
  if (pr) return <span className="inline-flex items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(pr)}</span>;
  return <span>{part.thread?.state ?? (part.item && THREAD_TEXT[part.item.status]) ?? ''}</span>;
}

export function LineC({ items, data, now, pick }: LineProps) {
  const parents = data.items.filter((p) => p.number !== null && p.status !== 'List' && p.status !== 'Done'
    && (CONCEPTS[p.number] !== undefined || p.labels.includes('concept') || data.items.some((c) => childOf(c, p))));
  const shown = new Set(items.map((i) => i.id));
  const dossiers = parents.map((parent) => ({ parent, parts: partsOf(parent, data) }))
    .filter(({ parent, parts }) => shown.has(parent.id) || parts.some((p) => p.item && shown.has(p.item.id)));
  const claimed = new Set(dossiers.flatMap(({ parent, parts }) => [parent.id, ...parts.flatMap((p) => (p.item ? [p.item.id] : []))]));
  const rows = items.filter((i) => !claimed.has(i.id) && i.status !== 'Done' && stageOf(i.status) >= 0)
    .sort((a, b) => stageOf(b.status) - stageOf(a.status));
  return (
    <div className="@container grid gap-4">
      {dossiers.map(({ parent, parts }) => <Dossier key={parent.id} parent={parent} parts={parts} data={data} now={now} pick={pick} />)}
      <div className="overflow-hidden rounded-xl border border-(--border) bg-(--card)">
        <StageHeader label={`Everything else in flight · ${rows.length}`} side="Thread · next" />
        {rows.length ? rows.map((i) => {
          const next = nextAction(i.status, i.blockedBy > 0);
          return (
            <Row key={i.id} item={i} data={data} now={now} pick={pick} waiting={i.blockedBy > 0}
              side={<><span className="min-w-0 truncate">{THREAD_TEXT[i.status]}</span>{next && <Act {...next} />}</>} />
          );
        }) : <p className="m-0 p-6 text-center text-(--muted-foreground)">Nothing else in flight.</p>}
      </div>
    </div>
  );
}
