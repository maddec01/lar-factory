// PROTOTYPE, throwaway. Variant A's concept block: a concept, or a parent whose builds span repos, as one wide block
// in its stage. Its head says where it stands and the one next action; opened, it reads top to bottom: the
// destination, decisions and open questions, then its tasks in order (decide, build per repo, end-to-end), each
// saying what it waits on and what it frees, and last its T3 threads, none waiting to be told to continue.

import type { ReactNode } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, CircleQuestionMark, CircleX, CornerDownRight, ExternalLink, Flag, Hammer, LayoutTemplate, MessageCircleQuestionMark, MessagesSquare, Play, Route } from 'lucide-react';
import { decisionType, kindOf, platformOf, prLabel, checkState, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';
import { Button, PlatformTag, STATUS_COLOR, StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, SliceBar } from '../item-bits.tsx';
import { CONCEPTS } from './line-data.ts';
import type { Pick } from '../list-sidebar.tsx';

type Concept = (typeof CONCEPTS)[number];
type Task = Concept['tasks'][number];
type Thread = Concept['threads'][number];
type Kind = Task['kind'];

export const picked = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : '');
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const mockOf = (i: Item): Concept | undefined => (i.number === null ? undefined : CONCEPTS[i.number]);
export const childrenOf = (p: Item, all: Item[]) => all.filter((i) => i.parent && i.parent.number === p.number && same(i.parent.repo, p.repo));
const landed = (i: Item | undefined) => !!i && (i.status === 'Done' || i.state === 'CLOSED' || i.state === 'MERGED');
/** The concept whose map lists this item as a task without GitHub's parent link, like #150 under #200. */
export const conceptOf = (i: Item) => Object.entries(CONCEPTS).find(([, c]) => c.tasks.some((t) => t.issue === i.number && same(t.repo, i.repo)))?.[0];

export function Chevron({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} aria-expanded={open} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="grid size-5 shrink-0 place-items-center rounded-sm text-(--muted-foreground) hover:bg-(--accent) hover:text-(--foreground)">
      {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </button>
  );
}

/** The repo's mark, the sidebar's coloured square with its first letter. */
export function RepoMark({ platform }: { platform: string }) {
  return <span title={platform} className="grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: platformColor(platform) }}>{platform[0]}</span>;
}

/** Thread and check states drawn with the status they amount to, so their colours are the board's. */
const THREAD_AS: Record<Thread['state'], Status> = { running: 'In progress', 'needs you': 'Needs you', done: 'Done', 'not started': 'Queued' };
const CHECK_AS: Record<Concept['endToEnd']['state'], Status | null> = { waiting: 'Queued', running: 'In progress', passed: 'Done', failed: null };
const KIND_ICON: Record<Kind, ReactNode> = {
  grill: <MessageCircleQuestionMark />, prototype: <LayoutTemplate />, research: <BookOpen />, build: <Hammer />, 'end-to-end': <Route />,
};
const DECIDE: Kind[] = ['grill', 'prototype', 'research'];

interface Placed { task: Task; item: Item | undefined; thread: Thread | undefined }

/** The concept's tasks: its map's when mocked, else its sub-issues as decisions and builds; any sub-issue the map
 *  misses is added, so nothing a concept owns goes unseen. */
function tasksOf(parent: Item, mock: Concept | undefined, kids: Item[]): Task[] {
  const tasks = [...(mock?.tasks ?? [])];
  for (const k of kids) {
    if (k.number === null || tasks.some((t) => t.issue === k.number && same(t.repo, k.repo))) continue;
    const d = decisionType(k);
    tasks.push({ issue: k.number, kind: d && (DECIDE as string[]).includes(d) ? (d as Kind) : 'build', waitsOn: [], repo: k.repo ?? parent.repo ?? '' });
  }
  return tasks;
}

/** The one thing to do next, and why: answer what waits on you, start what's free, or watch the end-to-end. */
function nextStep(placed: Placed[], mock: Concept | undefined): { label: string; why: string; target: Item | undefined; start?: boolean } {
  const n = (p: Placed) => `#${p.task.issue}`;
  const freed = (p: Placed) => placed.filter((o) => o.task.waitsOn.includes(p.task.issue)).map((o) => `${n(o)} ${o.item?.title ?? ''}`.trim());
  const yours = placed.find((p) => p.item && (p.item.status === 'Needs you' || p.item.status === 'Verify'));
  if (yours) {
    const after = freed(yours);
    return { label: `Answer ${n(yours)} in T3`, target: yours.item, why: `${n(yours)} ${yours.item!.title} waits on you.${after.length ? ` Then ${after.join(', ')} starts by itself.` : ''}` };
  }
  const free = placed.find((p) => p.item?.status === 'Ready' && p.task.waitsOn.every((w) => landed(placed.find((o) => o.task.issue === w)?.item)));
  if (free) return { label: `Start ${n(free)}`, target: free.item, start: true, why: `${n(free)} ${free.item!.title} is refined and nothing it waits on is open.` };
  const builds = placed.filter((p) => p.task.kind === 'build');
  const e2e = mock?.endToEnd;
  if (builds.length && builds.every((p) => landed(p.item)) && e2e) {
    if (e2e.state === 'passed') return { label: 'Verify and close', target: undefined, why: 'Every build landed and the end-to-end check passed. Try it yourself, then close the concept.' };
    if (e2e.state === 'failed') return { label: 'Open the failing check', target: undefined, why: 'Every build landed but the end-to-end check failed; a fix thread starts once you look.' };
    return { label: 'Watch end-to-end', target: undefined, why: `Every build landed; the agents are ${e2e.state === 'running' ? 'running' : 'about to run'} the end-to-end check. Nothing waits on you.` };
  }
  return { label: 'Open the map', target: undefined, why: 'Threads are working; nothing waits on you.' };
}

function Section({ title, icon, aside, children }: { title: string; icon: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-2">
      <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-medium [&>svg]:size-3.5 [&>svg]:text-(--muted-foreground)">{icon}{title}{aside && <span className="font-normal text-(--muted-foreground)">{aside}</span>}</h3>
      {children}
    </section>
  );
}

/** A small button naming another item; picking it opens its details. */
function ItemChip({ item, issue, pick }: { item: Item | undefined; issue: number; pick: Pick }) {
  return (
    <button type="button" disabled={!item} onClick={(e) => { e.stopPropagation(); if (item) pick.set(item.id); }}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-(--border) bg-(--background) px-1.5 py-0.5 text-[11px] hover:bg-(--accent)">
      {item ? <StatusGlyph status={item.status} className="size-3" /> : null}
      <span className="truncate">{item ? <ItemTitle item={item} /> : `#${issue}`}</span>
      {item && <span className="shrink-0 text-(--muted-foreground)">· {item.status}</span>}
    </button>
  );
}

function ThreadChip({ thread }: { thread: Thread | undefined }) {
  if (!thread) return <span className="text-[11px] text-(--muted-foreground)">no thread</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-(--muted-foreground)"><StatusGlyph status={THREAD_AS[thread.state]} className="size-3" />thread {thread.state}</span>;
}

/** One task: its kind, item and thread; under it what it waits on and what it frees, and a build's slices and PRs. */
function TaskRow({ p, placed, pick }: { p: Placed; placed: Placed[]; pick: Pick }) {
  const { task, item, thread } = p;
  const waits = task.waitsOn.map((w) => placed.find((o) => o.task.issue === w) ?? { task: { issue: w } as Task, item: undefined, thread: undefined });
  const open = waits.filter((w) => !landed(w.item));
  const frees = placed.filter((o) => o.task.waitsOn.includes(task.issue));
  const done = item?.slices.filter((s) => s.progress === 'done').length ?? 0;
  return (
    <li onClick={() => item && pick.set(item.id)}
      className={`grid cursor-default gap-1.5 rounded-lg border bg-(--card) px-2.5 py-2 hover:bg-(--accent) ${open.length ? 'border-dashed border-(--input)' : 'border-(--border)'} ${picked(!!item && pick.id === item.id)}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" size="sm" className="shrink-0 gap-1 font-medium capitalize [&_svg]:size-3">{KIND_ICON[task.kind]}{task.kind}</Badge>
        {item && <StatusGlyph status={item.status} />}
        <button type="button" onClick={(e) => { e.stopPropagation(); if (item) pick.set(item.id); }} className="min-w-0 flex-1 truncate text-left font-medium">
          {item ? <ItemTitle item={item} /> : `#${task.issue}`}
        </button>
        <span className="hidden shrink-0 text-xs text-(--muted-foreground) @min-[880px]:inline">{item?.status ?? 'not on the board'}</span>
        <ThreadChip thread={thread} />
        {item?.status === 'Needs you' && <Button primary small>Answer</Button>}
        {item?.status === 'Ready' && !open.length && <Button primary small><Play />Start</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[11px] text-(--muted-foreground)">
        <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
          <CornerDownRight className="size-3" />
          {waits.length ? <>waits on {waits.map((w) => <ItemChip key={w.task.issue} item={w.item} issue={w.task.issue} pick={pick} />)}</>
            : task.kind === 'build' ? 'waits on nothing, runs in parallel' : 'waits on nothing'}
        </span>
        {open.length > 0 && thread?.state === 'not started' && <span className="text-(--warning-foreground)">its thread starts once {open.map((w) => `#${w.task.issue}`).join(', ')} {open.length > 1 ? 'land' : 'lands'}</span>}
        {frees.length > 0 && <span>frees {frees.map((f) => `#${f.task.issue}`).join(', ')}</span>}
      </div>
      {item && (item.slices.length > 0 || item.linkedPrs.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[11px] text-(--muted-foreground)">
          {item.slices.length > 0 && <span className="inline-flex items-center gap-2"><span className="w-28"><SliceBar item={item} /></span>{done}/{item.slices.length} slices</span>}
          {item.linkedPrs.map((pr) => {
            const st = checkState(pr.checks);
            return <span key={pr.number} className="inline-flex items-center gap-1">{prLabel(pr)}{st && <><span className="size-1.5 rounded-full" style={{ background: st === 'failed' ? 'var(--error)' : st === 'running' ? 'var(--warning)' : 'var(--st-done)' }} />checks {st}</>}</span>;
          })}
        </div>
      )}
    </li>
  );
}

/** Decide, build, end-to-end, merge: how far each phase is, as a strip under the head. */
function PhaseStrip({ placed, mock, parent }: { placed: Placed[]; mock: Concept | undefined; parent: Item }) {
  const decide = placed.filter((p) => DECIDE.includes(p.task.kind));
  const builds = placed.filter((p) => p.task.kind === 'build');
  const e2e = mock?.endToEnd;
  const count = (ps: Placed[]) => `${ps.filter((p) => landed(p.item)).length}/${ps.length}`;
  const phases: { name: string; detail: string; status: Status }[] = [
    { name: 'Decide', detail: decide.length ? count(decide) : 'none', status: decide.every((p) => landed(p.item)) ? 'Done' : decide.some((p) => p.item?.status === 'Needs you') ? 'Needs you' : 'Shaping' },
    { name: 'Build', detail: builds.length ? count(builds) : 'none', status: builds.length && builds.every((p) => landed(p.item)) ? 'Done' : builds.some((p) => p.item?.status === 'In progress' || p.item?.status === 'Review') ? 'In progress' : 'Queued' },
    { name: 'End-to-end', detail: e2e?.state ?? 'not set', status: (e2e && CHECK_AS[e2e.state]) ?? 'Queued' },
    { name: 'Merge', detail: parent.status === 'Done' ? 'done' : 'after the check', status: parent.status === 'Done' ? 'Done' : 'Queued' },
  ];
  return (
    <ol className="m-0 grid list-none grid-cols-4 gap-1 p-0">
      {phases.map((ph) => (
        <li key={ph.name} className="grid min-w-0 gap-1">
          <span className="h-1 rounded-full" style={{ background: ph.status === 'Queued' ? 'var(--soft)' : STATUS_COLOR[ph.status] }} />
          <span className="flex min-w-0 items-center gap-1 text-[11px]"><StatusGlyph status={ph.status} className="size-3" /><span className="truncate font-medium">{ph.name}</span><span className="truncate text-(--muted-foreground)">{ph.detail}</span></span>
        </li>
      ))}
    </ol>
  );
}

/** Links "(#201)" in a mocked sentence to the item it names. */
function Refs({ text, via, find, pick }: { text: string; via: string; find: (n: number) => Item | undefined; pick: Pick }) {
  const m = text.match(/^(.*?)\s*\(#(\d+)[^)]*\)\.?$/);
  if (!m) return <>{text}</>;
  const n = Number(m[2]);
  return <><span>{m[1]}</span> <span className="whitespace-nowrap text-xs text-(--muted-foreground)">{via}</span> <ItemChip item={find(n)} issue={n} pick={pick} /></>;
}

export function ConceptBlock({ item, data, now, pick, open, onToggle }: { item: Item; data: BoardData; now: number; pick: Pick; open: boolean; onToggle: () => void }) {
  const mock = mockOf(item);
  const kids = childrenOf(item, data.items);
  const find = (n: number, repo?: string) => data.items.find((i) => i.number === n && (repo ? same(i.repo, repo) : true));
  const placed: Placed[] = tasksOf(item, mock, kids).map((task) => ({ task, item: find(task.issue, task.repo), thread: mock?.threads.find((t) => t.issue === task.issue) }));
  const decide = placed.filter((p) => DECIDE.includes(p.task.kind));
  const builds = placed.filter((p) => p.task.kind === 'build');
  const repos = [...new Set(builds.map((p) => p.task.repo))];
  const platforms = [...new Set([item, ...kids].map((i) => platformOf(i, data.repos)))];
  const concept = kindOf(item) === 'concept';
  const step = nextStep(placed, mock);
  const threads = mock?.threads ?? [];
  const e2e = mock?.endToEnd;
  const e2eStatus = e2e && CHECK_AS[e2e.state];
  const yours = placed.filter((p) => p.item?.status === 'Needs you' || p.item?.status === 'Verify').length;
  const platformName = (repo: string) => data.repos.find((r) => same(r.repo, repo))?.platform ?? repo.split('/')[1] ?? repo;
  return (
    <article className={`grid gap-3 rounded-xl border border-(--border) bg-(--card) p-3 shadow-[inset_3px_0_0_var(--primary)] ${picked(pick.id === item.id)}`}>
      <header className="grid gap-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <Chevron open={open} onClick={onToggle} label={`#${item.number} ${item.title}`} />
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={concept ? 'info' : 'secondary'} size="sm" className="shrink-0">{concept ? 'Concept' : 'Coupled work'}</Badge>
              <span className="flex shrink-0 -space-x-1">{platforms.map((p) => <RepoMark key={p} platform={p} />)}</span>
              <button type="button" onClick={() => pick.set(item.id)} className="min-w-0 truncate text-left text-[15px] font-semibold tracking-tight hover:underline"><ItemTitle item={item} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-(--muted-foreground)">
              <span className="inline-flex items-center gap-1 text-(--foreground)"><StatusGlyph status={item.status} />{item.status}</span>
              <span>{placed.filter((p) => landed(p.item)).length} of {placed.length} tasks done</span>
              {yours > 0 && <span className="text-(--warning-foreground)">{yours} {yours > 1 ? 'need' : 'needs'} you</span>}
              {threads.length > 0 && <span>threads: {(['running', 'needs you', 'not started', 'done'] as const).map((s) => [s, threads.filter((t) => t.state === s).length] as const).filter(([, c]) => c).map(([s, c]) => `${c} ${s}`).join(', ')}</span>}
              <span>{platforms.join(' + ')}</span>
              <span>updated {shortAgo(item.updatedAt, now)}</span>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {item.url && <a href={item.url} target="_blank" rel="noopener" aria-label="Open on GitHub" className="hidden @min-[640px]:inline"><Button small><ExternalLink />GitHub</Button></a>}
            <Button primary small onClick={() => step.target && pick.set(step.target.id)}>{step.start && <Play />}{step.label}</Button>
          </span>
        </div>
        <div className="pl-7"><PhaseStrip placed={placed} mock={mock} parent={item} /></div>
      </header>
      {open && (
        <div className="grid gap-4 pl-7">
          {mock && (
            <>
              <p className="m-0 flex gap-2 rounded-lg bg-(--muted) px-3 py-2.5 leading-relaxed"><Flag className="mt-0.5 size-4 shrink-0 text-(--primary)" /><span><span className="font-medium">Destination. </span>{mock.destination}</span></p>
              <div className="grid gap-4 @min-[720px]:grid-cols-2">
                <Section title="Decisions" icon={<Check />} aside={mock.decisions.length}>
                  <ul className="m-0 grid list-none gap-1.5 p-0">
                    {mock.decisions.map((d) => <li key={d} className="flex gap-2 text-[13px] leading-snug"><Check className="mt-0.5 size-3.5 shrink-0 text-(--st-done)" /><span className="min-w-0"><Refs text={d} via="from" find={(n) => find(n)} pick={pick} /></span></li>)}
                  </ul>
                </Section>
                <Section title="Open questions" icon={<CircleQuestionMark />} aside={mock.open.length || 'none'}>
                  {mock.open.length ? (
                    <ul className="m-0 grid list-none gap-1.5 p-0">
                      {mock.open.map((q) => <li key={q} className="flex gap-2 text-[13px] leading-snug"><CircleQuestionMark className="mt-0.5 size-3.5 shrink-0 text-(--warning)" /><span className="min-w-0"><Refs text={q} via="answered by" find={(n) => find(n)} pick={pick} /></span></li>)}
                    </ul>
                  ) : <p className="m-0 text-[13px] text-(--muted-foreground)">Every question is answered.</p>}
                </Section>
              </div>
            </>
          )}
          <Section title="Tasks, and what waits on what" icon={<Route />}>
            <ol className="m-0 grid list-none gap-3 border-l-2 border-(--border) p-0 pl-4">
              <Phase n={1} title="Decide" aside="grill, prototype, research">
                {decide.length ? <ul className="m-0 grid list-none gap-1.5 p-0">{decide.map((p) => <TaskRow key={p.task.issue} p={p} placed={placed} pick={pick} />)}</ul>
                  : <p className="m-0 text-xs text-(--muted-foreground)">Nothing to decide; the builds were clear from the start.</p>}
              </Phase>
              <Phase n={2} title="Build" aside={repos.length > 1 ? `${repos.length} repos` : repos.length ? platformName(repos[0]!) : 'none yet'}>
                <div className={`grid gap-3 ${repos.length > 1 ? '@min-[720px]:grid-cols-2' : ''}`}>
                  {repos.map((repo) => (
                    <div key={repo} className="grid min-w-0 content-start gap-1.5 border-l-2 pl-2.5" style={{ borderColor: platformColor(platformName(repo)) }}>
                      <span><PlatformTag platform={platformName(repo)} /></span>
                      <ul className="m-0 grid list-none gap-1.5 p-0">{builds.filter((p) => p.task.repo === repo).map((p) => <TaskRow key={p.task.issue} p={p} placed={placed} pick={pick} />)}</ul>
                    </div>
                  ))}
                </div>
              </Phase>
              <Phase n={3} title="End-to-end" aside={e2e ? 'the agents run it once every build lands' : undefined}>
                {e2e ? (
                  <div className="grid gap-2 rounded-lg border border-(--border) bg-(--card) px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" size="sm" className="shrink-0 gap-1 [&_svg]:size-3"><Route />check</Badge>
                      {e2eStatus ? <StatusGlyph status={e2eStatus} /> : <CircleX className="size-3.5 shrink-0 text-(--error)" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{e2e.title}</span>
                      <span className="shrink-0 text-xs text-(--muted-foreground)">{e2e.state}</span>
                    </div>
                    <ol className="m-0 grid gap-0.5 pl-9 text-[13px] text-(--muted-foreground)">{e2e.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <span className="flex flex-wrap items-center gap-1 pl-1 text-[11px] text-(--muted-foreground)"><CornerDownRight className="size-3" />waits on {builds.map((p) => <ItemChip key={p.task.issue} item={p.item} issue={p.task.issue} pick={pick} />)}</span>
                  </div>
                ) : <p className="m-0 text-xs text-(--muted-foreground)">No end-to-end check yet; shaping writes one.</p>}
              </Phase>
            </ol>
          </Section>
          {threads.length > 0 && (
            <Section title="Threads in T3 Code" icon={<MessagesSquare />} aside="each starts itself once it can run">
              <ul className="m-0 grid list-none gap-px overflow-hidden rounded-lg border border-(--border) bg-(--border) p-0">
                {threads.map((t) => {
                  const p = placed.find((o) => o.task.issue === t.issue);
                  const blockers = p?.task.waitsOn.filter((w) => !landed(placed.find((o) => o.task.issue === w)?.item)) ?? [];
                  return (
                    <li key={t.title} className="flex min-w-0 items-center gap-2 bg-(--card) px-2.5 py-1.5 text-[13px]">
                      <StatusGlyph status={THREAD_AS[t.state]} />
                      <span className="min-w-0 flex-1 truncate">{t.title} <span className="text-(--muted-foreground)">#{t.issue}</span></span>
                      <span className="hidden shrink-0 text-xs text-(--muted-foreground) @min-[560px]:inline">
                        {t.state === 'not started' ? (blockers.length ? `starts when ${blockers.map((b) => `#${b}`).join(', ')} lands` : 'starts now') : `${t.state} · ${shortAgo(t.updated, now)}`}
                      </span>
                      {t.state !== 'not started' && <Button small>{t.state === 'needs you' ? 'Answer' : 'Open'}</Button>}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
          <p className="m-0 flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] px-3 py-2 text-[13px]">
            <span className="font-medium">Next</span><span className="min-w-0 flex-1 text-(--muted-foreground)">{step.why}</span>
          </p>
        </div>
      )}
    </article>
  );
}

function Phase({ n, title, aside, children }: { n: number; title: string; aside?: string; children: ReactNode }) {
  return (
    <li className="relative grid gap-2">
      <span className="absolute -left-[27px] top-0 grid size-5 place-items-center rounded-full border border-(--border) bg-(--card) text-[10px] font-semibold tabular-nums">{n}</span>
      <h4 className="m-0 text-xs font-medium">{title}{aside && <span className="font-normal text-(--muted-foreground)"> · {aside}</span>}</h4>
      {children}
    </li>
  );
}
