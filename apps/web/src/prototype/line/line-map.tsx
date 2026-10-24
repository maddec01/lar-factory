// PROTOTYPE, throwaway. A dossier's map: one lane per repo plus a Decisions lane, tasks placed left to right by
// what they wait on, arrows between them, ending in the end-to-end check.

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, CircleX, FlaskConical, Hammer, Lightbulb, MessagesSquare, Shapes, Target } from 'lucide-react';
import { decisionType, platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { Button, StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, SliceBar } from '../item-bits.tsx';
import type { Pick } from '../list-sidebar.tsx';
import { CONCEPTS } from './line-data.ts';

type Concept = (typeof CONCEPTS)[number];
type Thread = Concept['threads'][number];
type Kind = Concept['tasks'][number]['kind'];
interface Task { issue: number; kind: Kind; waitsOn: number[]; repo: string; item: Item | undefined }

const DECISIONS = 'Decisions';
const DECISION_KINDS: Kind[] = ['grill', 'prototype', 'research'];
const KIND_ICON: Record<Kind, typeof Hammer> = { grill: MessagesSquare, prototype: Shapes, research: BookOpen, build: Hammer, 'end-to-end': FlaskConical };
/** A thread's or check's state, drawn with the glyph of the status it reads as. */
const THREAD_STATUS: Record<Thread['state'], Status> = { running: 'In progress', 'needs you': 'Needs you', done: 'Done', 'not started': 'Queued' };
const CHECK_STATUS: Record<Concept['endToEnd']['state'], Status | null> = { waiting: 'Queued', running: 'In progress', passed: 'Done', failed: null };

const isChild = (i: Item, head: Item) => i.parent?.number === head.number && i.parent.repo === head.repo;
const isDone = (i: Item | undefined) => !!i && (i.status === 'Done' || i.state === 'CLOSED' || i.state === 'MERGED');
/** Past waiting: a thread has taken it on, whatever it waited for. */
const started = (i: Item | undefined) => !!i && ['In progress', 'Review', 'Verify', 'Ready to merge', 'Done'].includes(i.status);
const picked = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--card)' : '');


/** A big item's tasks, from the mock where there is one, else its sub-issues with no known order; and every item it holds. */
export function workOf(head: Item, data: BoardData) {
  const mock = head.number !== null ? CONCEPTS[head.number] : undefined;
  const children = data.items.filter((i) => isChild(i, head));
  const tasks: Task[] = mock
    ? mock.tasks.filter((t) => t.kind !== 'end-to-end').map((t) => ({ ...t, item: data.items.find((i) => i.number === t.issue && i.repo === t.repo) }))
    : children.map((i) => {
      const d = decisionType(i);
      return { issue: i.number ?? 0, kind: d && (DECISION_KINDS as string[]).includes(d) ? d as Kind : 'build', waitsOn: [], repo: i.repo ?? '', item: i };
    });
  const members = [...new Set([...children, ...tasks.flatMap((t) => (t.item ? [t.item] : []))])];
  return { mock, tasks, members };
}

function CheckGlyph({ state, className = 'size-3.5' }: { state: Concept['endToEnd']['state']; className?: string }) {
  const s = CHECK_STATUS[state];
  return s ? <StatusGlyph status={s} className={className} /> : <CircleX className={`shrink-0 text-(--error) ${className}`} strokeWidth={2.25} />;
}

// ---------- the map ----------

const LABEL_W = 116;
const NODE_H = 132;
const GAP = 12;
const PAD = 14;
const HEAD_H = 30;
const MIN_COL = 200;

interface Placed { key: string; task: Task | null; lane: number; col: number; x: number; y: number }

function layout(tasks: Task[], data: BoardData, width: number) {
  const depth = new Map<number, number>();
  const at = (t: Task, path: number[]): number => {
    const known = depth.get(t.issue);
    if (known !== undefined) return known;
    const ups = tasks.filter((u) => t.waitsOn.includes(u.issue) && !path.includes(u.issue));
    const d = ups.length ? Math.max(...ups.map((u) => at(u, [...path, t.issue]))) + 1 : 0;
    depth.set(t.issue, d);
    return d;
  };
  tasks.forEach((t) => at(t, []));
  const laneOf = (t: Task) => (DECISION_KINDS.includes(t.kind) ? DECISIONS : platformOf({ repo: t.repo } as Item, data.repos));
  const named = [DECISIONS, ...data.repos.map((r) => r.platform), ...tasks.map(laneOf)];
  const lanes = [...new Set(named)].filter((l) => tasks.some((t) => laneOf(t) === l));
  const cols = Math.max(0, ...depth.values()) + 2;
  const colW = Math.max(MIN_COL, Math.floor((width - LABEL_W) / cols));
  const nodeW = colW - 28;
  const placed: Placed[] = [];
  const bands: { lane: string; top: number; height: number }[] = [];
  let top = HEAD_H;
  lanes.forEach((lane, li) => {
    const here = tasks.filter((t) => laneOf(t) === lane);
    const rows = Math.max(1, ...Array.from({ length: cols }, (_, c) => here.filter((t) => depth.get(t.issue) === c).length));
    for (let c = 0; c < cols; c++) {
      here.filter((t) => depth.get(t.issue) === c).forEach((t, r) => placed.push({ key: String(t.issue), task: t, lane: li, col: c, x: LABEL_W + c * colW + 14, y: top + PAD + r * (NODE_H + GAP) }));
    }
    const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP;
    bands.push({ lane, top, height });
    top += height;
  });
  placed.push({ key: 'e2e', task: null, lane: -1, col: cols - 1, x: LABEL_W + (cols - 1) * colW + 14, y: Math.max(HEAD_H + PAD, (HEAD_H + top) / 2 - NODE_H / 2) });
  // The check waits on every build; arrows come only from the last ones, the rest it waits on through them.
  const sinks = tasks.filter((t) => !tasks.some((u) => u.waitsOn.includes(t.issue)));
  const ends = sinks.filter((t) => t.kind === 'build');
  const edges = [
    ...tasks.flatMap((t) => t.waitsOn.filter((n) => tasks.some((u) => u.issue === n)).map((n) => ({ from: String(n), to: String(t.issue) }))),
    ...(ends.length ? ends : sinks).map((t) => ({ from: String(t.issue), to: 'e2e' })),
  ];
  return { placed, bands, edges, cols, colW, nodeW, width: LABEL_W + cols * colW, height: Math.max(top, HEAD_H + PAD * 2 + NODE_H) };
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function TaskNode({ task, thread, waits, now, pick, width, armed, onArm }: {
  task: Task; thread: Thread | undefined; waits: Task[]; now: number; pick: Pick; width: number; armed: boolean; onArm: () => void;
}) {
  const { item } = task;
  const Icon = KIND_ICON[task.kind];
  const open = started(item) ? [] : waits.filter((w) => !isDone(w.item));
  const after = open.map((w) => `#${w.issue}`).join(', ');
  const tone = item?.status === 'Needs you' ? 'border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] shadow-[inset_3px_0_0_var(--warning)]'
    : isDone(item) ? 'border-(--border) bg-(--muted)' : open.length ? 'border-dashed border-(--input)' : 'border-(--border)';
  let action: ReactNode = null;
  if (item?.status === 'Needs you') action = <Button primary small>Answer in T3</Button>;
  else if (item?.status === 'Ready' && !open.length) action = <Button primary small>Start</Button>;
  else if (item?.status === 'Ready') action = <Button small onClick={onArm}>{armed ? `Starts after ${after} ✓` : `Start after ${after}`}</Button>;
  else if (open.length) action = <span className="text-[11px] text-(--muted-foreground)">starts by itself after {after}</span>;
  else if (thread?.state === 'running') action = <span className="text-[11px] text-(--muted-foreground)">thread working · {shortAgo(thread.updated, now)}</span>;
  return (
    <div style={{ width, height: NODE_H }}
      className={`relative flex flex-col gap-1 rounded-lg border bg-(--card) px-2.5 py-2 text-left shadow-xs ${tone} ${picked(!!item && pick.id === item.id)}`}>
      {item && <button type="button" aria-label={`Open #${task.issue}`} onClick={() => pick.set(item.id)} className="absolute inset-0 rounded-lg hover:bg-[color-mix(in_srgb,var(--accent)_60%,transparent)]" />}
      <span className="pointer-events-none relative flex items-center gap-1.5 text-[11px] text-(--muted-foreground)">
        <Icon className="size-3.5 shrink-0" />{task.kind}
        <span className="ml-auto inline-flex items-center gap-1" title={thread ? `T3 thread: ${thread.title} (${thread.state})` : 'No T3 thread'}>
          {thread ? <><StatusGlyph status={THREAD_STATUS[thread.state]} className="size-3" />thread</> : 'no thread'}
        </span>
      </span>
      <span className="pointer-events-none relative line-clamp-2 text-[13px] font-medium leading-snug">
        {item ? <ItemTitle item={item} /> : <><span className="font-normal text-(--muted-foreground)">#{task.issue}</span> not on the board</>}
      </span>
      {item && item.slices.length > 0 && <span className="pointer-events-none relative"><SliceBar item={item} /></span>}
      <span className="pointer-events-none relative mt-auto flex items-center gap-1.5 text-xs">
        {item && <><StatusGlyph status={item.status} className="size-3" />{item.status}</>}
        {thread && <span className="truncate text-(--muted-foreground)">· {thread.state}</span>}
      </span>
      {action && <span className="relative flex min-h-6 items-center">{action}</span>}
    </div>
  );
}

function CheckNode({ check, width, after }: { check: Concept['endToEnd']; width: number; after: string }) {
  return (
    <div style={{ width, height: NODE_H }} className={`flex flex-col gap-1 rounded-lg border-2 bg-(--card) px-2.5 py-2 shadow-xs ${check.state === 'passed' ? 'border-(--st-done)' : check.state === 'running' ? 'border-(--st-now)' : 'border-dashed border-(--input)'}`}>
      <span className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)"><FlaskConical className="size-3.5" />end-to-end check</span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug">{check.title}</span>
      <span className="mt-auto flex items-center gap-1.5 text-xs"><CheckGlyph state={check.state} className="size-3" />{check.state} · {check.steps.length} steps</span>
      <span className="text-[11px] text-(--muted-foreground)">{check.state === 'waiting' ? `agents run it once ${after} land` : `after ${after}`}</span>
    </div>
  );
}

export function WorkMap({ tasks, mock, data, now, pick }: { tasks: Task[]; mock: Concept | undefined; data: BoardData; now: number; pick: Pick }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<string | null>(null);
  const [armed, setArmed] = useState<Set<number>>(new Set());
  const marker = useId().replace(/[^a-zA-Z0-9]/g, '');
  const m = layout(tasks, data, width);
  const at = new Map(m.placed.map((p) => [p.key, p]));
  const near = (key: string) => !hover || key === hover || m.edges.some((e) => (e.from === hover && e.to === key) || (e.to === hover && e.from === key));
  const builds = tasks.filter((t) => t.kind === 'build').map((t) => `#${t.issue}`).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const inCol = (c: number) => m.placed.filter((p) => p.col === c && p.task).length;
  return (
    <div ref={ref} className="overflow-x-auto rounded-lg border border-(--border) bg-(--background)">
      <div className="relative" style={{ width: m.width, height: m.height }}>
        {m.bands.map((b, n) => (
          <div key={b.lane} className={`absolute left-0 border-t border-(--border) ${n % 2 ? 'bg-[color-mix(in_srgb,var(--muted)_50%,transparent)]' : ''}`} style={{ top: b.top, height: b.height, width: m.width }}>
            <div className="sticky left-0 flex h-full flex-col justify-center gap-0.5 bg-[color-mix(in_srgb,var(--background)_85%,transparent)] px-3" style={{ width: LABEL_W }}>
              <span className="flex items-center gap-1.5 text-xs font-medium">
                {b.lane === DECISIONS ? <Lightbulb className="size-3.5 text-(--muted-foreground)" /> : <span className="size-2 rounded-full" style={{ background: platformColor(b.lane) }} />}{b.lane}
              </span>
              <span className="text-[11px] text-(--muted-foreground)">{b.lane === DECISIONS ? 'grill, prototype, research' : data.repos.find((r) => r.platform === b.lane)?.repo.split('/')[1]}</span>
            </div>
          </div>
        ))}
        {Array.from({ length: m.cols }, (_, c) => (
          <span key={c} className="absolute flex h-[30px] items-center gap-1 text-[11px] text-(--muted-foreground)" style={{ left: LABEL_W + c * m.colW + 14 }}>
            {c === m.cols - 1 ? <><Target className="size-3" />Check</> : <>Wave {c + 1}{inCol(c) > 1 && <span>· {inCol(c)} in parallel</span>}</>}
          </span>
        ))}
        <svg className="pointer-events-none absolute inset-0" width={m.width} height={m.height} aria-hidden="true">
          <defs>
            {['done', 'open'].map((k) => (
              <marker key={k} id={`${marker}-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 8 4 0 8z" fill={k === 'done' ? 'var(--st-done)' : 'var(--muted-foreground)'} />
              </marker>
            ))}
          </defs>
          {m.edges.map((e) => {
            const a = at.get(e.from), b = at.get(e.to);
            if (!a || !b) return null;
            const done = isDone(a.task?.item);
            const x1 = a.x + m.nodeW, y1 = a.y + NODE_H / 2, x2 = b.x - 2, y2 = b.y + NODE_H / 2, mid = (x1 + x2) / 2;
            // Over a column, the arrow leaves from the node's foot and runs in the gap under the row, not behind a node.
            const sx = x1 - 20, wy = a.y + NODE_H + GAP / 2;
            const d = b.col - a.col > 1
              ? `M${sx} ${a.y + NODE_H} L${sx} ${wy - 6} Q${sx} ${wy} ${sx + 6} ${wy} L${x2 - 30} ${wy} C${x2 - 12} ${wy} ${x2 - 18} ${y2} ${x2} ${y2}`
              : `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
            const lit = !!hover && (e.from === hover || e.to === hover);
            return (
              <path key={`${e.from}-${e.to}`} d={d} fill="none"
                stroke={done ? 'var(--st-done)' : 'var(--muted-foreground)'} strokeWidth={lit ? 2.5 : 1.5} strokeDasharray={done ? undefined : '5 4'}
                opacity={hover && !lit ? 0.2 : done ? 0.7 : 0.9} markerEnd={`url(#${marker}-${done ? 'done' : 'open'})`} />
            );
          })}
        </svg>
        {m.placed.map((p) => (
          <div key={p.key} className={`absolute transition-opacity ${near(p.key) ? '' : 'opacity-40'}`} style={{ left: p.x, top: p.y }}
            onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
            {p.task
              ? <TaskNode task={p.task} thread={mock?.threads.find((t) => t.issue === p.task!.issue)} waits={tasks.filter((t) => p.task!.waitsOn.includes(t.issue))}
                  now={now} pick={pick} width={m.nodeW} armed={armed.has(p.task.issue)}
                  onArm={() => setArmed((s) => { const n = new Set(s); if (!n.delete(p.task!.issue)) n.add(p.task!.issue); return n; })} />
              : mock
                ? <CheckNode check={mock.endToEnd} width={m.nodeW} after={builds} />
                : <div style={{ width: m.nodeW, height: NODE_H }} className="grid place-items-center rounded-lg border-2 border-dashed border-(--input) p-3 text-center text-xs text-(--muted-foreground)">No end-to-end check written yet</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
