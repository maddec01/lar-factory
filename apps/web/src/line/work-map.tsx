// A dossier's map: one lane per repository plus a Decisions lane, parts placed left to right by what they wait on,
// arrows between them, ending in the end-to-end check, or a note that none is written yet.

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, FlaskConical, Hammer, ListChecks, Lightbulb, MessagesSquare, Shapes, Target } from 'lucide-react';
import { ref, refKey, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { AzureFields, ItemTitle, SliceBar } from '../items/item-parts.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { ItemStatusGlyph, StatusGlyph } from '../items/status-glyph.tsx';
import { DECISION_KINDS, THREAD_GLYPH, isDone, openWaits, partWaves, waitText } from './dossier-parts.ts';
import type { Part, PartKind } from './dossier-parts.ts';
import { PartStart } from './part-start.tsx';

const DECISIONS = 'Decisions';
const KIND_ICON: Record<PartKind, typeof Hammer> = { grill: MessagesSquare, prototype: Shapes, research: BookOpen, task: ListChecks, build: Hammer };
const CHECK = 'e2e';
const keyOf = (p: Part) => refKey(p.item.repo, p.item.number);
const pickedRing = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--card)' : '');

const LABEL_W = 116;
const NODE_H = 132;
const GAP = 12;
const PAD = 14;
const HEAD_H = 30;
const MIN_COL = 200;

interface Placed { key: string; part: Part | null; col: number; x: number; y: number }

function layout(parts: Part[], data: BoardData, width: number) {
  const keys = new Map(parts.map((p) => [keyOf(p), p]));
  const ups = (p: Part) => p.waitsOn.flatMap((b) => keys.get(refKey(b.repo, b.number)) ?? []);
  const depth = partWaves(parts);
  const laneOf = (p: Part) => (DECISION_KINDS.includes(p.kind) ? DECISIONS : repoKey(p.item));
  const named = [DECISIONS, ...data.repos.map((r) => r.repo), ...parts.map(laneOf)];
  const lanes = [...new Set(named)].filter((l) => parts.some((p) => laneOf(p) === l));
  const cols = Math.max(0, ...depth.values()) + 2;
  const colW = Math.max(MIN_COL, Math.floor((width - LABEL_W) / cols));
  const nodeW = colW - 28;
  const placed: Placed[] = [];
  const bands: { lane: string; top: number; height: number }[] = [];
  let top = HEAD_H;
  lanes.forEach((lane) => {
    const here = parts.filter((p) => laneOf(p) === lane);
    const rows = Math.max(1, ...Array.from({ length: cols }, (_, c) => here.filter((p) => depth.get(keyOf(p)) === c).length));
    for (let c = 0; c < cols; c++) {
      here.filter((p) => depth.get(keyOf(p)) === c).forEach((p, r) => placed.push({ key: keyOf(p), part: p, col: c, x: LABEL_W + c * colW + 14, y: top + PAD + r * (NODE_H + GAP) }));
    }
    const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP;
    bands.push({ lane, top, height });
    top += height;
  });
  placed.push({ key: CHECK, part: null, col: cols - 1, x: LABEL_W + (cols - 1) * colW + 14, y: Math.max(HEAD_H + PAD, (HEAD_H + top) / 2 - NODE_H / 2) });
  // The check waits on every build; arrows come only from the last ones, the rest it waits on through them.
  const sinks = parts.filter((p) => !parts.some((u) => ups(u).includes(p)));
  const ends = sinks.filter((p) => p.kind === 'build');
  const edges = [
    ...parts.flatMap((p) => ups(p).map((u) => ({ from: keyOf(u), to: keyOf(p) }))),
    ...(ends.length ? ends : sinks).map((p) => ({ from: keyOf(p), to: CHECK })),
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

function PartNode({ part, data, now, width }: { part: Part; data: BoardData; now: number; width: number }) {
  const { item, thread } = part;
  const isPicked = useItemDialogStore((state) => state.itemId === item.id);
  const Icon = KIND_ICON[part.kind];
  const open = openWaits(part);
  const tone = item.status === 'Needs you' ? 'border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] shadow-[inset_3px_0_0_var(--warning)]'
    : isDone(item) ? 'border-(--border) bg-(--muted)' : open.length ? 'border-dashed border-(--input)' : 'border-(--border)';
  let action: ReactNode = null;
  if (item.status === 'Needs you') action = <OpenThread item={item} data={data} label="Answer in T3" />;
  else if (item.status === 'Ready' || item.status === 'Queued') action = <PartStart part={part} data={data} label="Start" />;
  else if (open.length) action = <span className="text-[11px] text-(--muted-foreground)">starts by itself after {waitText(item, open)}</span>;
  else if (thread?.state === 'running') action = <span className="text-[11px] text-(--muted-foreground)">thread working · {shortAgo(thread.updated, now)}</span>;
  return (
    <div style={{ width, height: NODE_H }} data-map-part={item.id}
      className={`relative flex flex-col gap-1 rounded-lg border bg-(--card) px-2.5 py-2 text-left shadow-xs ${tone} ${pickedRing(isPicked)}`}>
      <button type="button" aria-label={`Open ${ref(item)}`} onClick={() => useItemDialogStore.getState().open(item.id)} className="absolute inset-0 rounded-lg hover:bg-[color-mix(in_srgb,var(--accent)_60%,transparent)]" />
      <span className="pointer-events-none relative flex items-center gap-1.5 text-[11px] text-(--muted-foreground)">
        <Icon className="size-3.5 shrink-0" />{part.kind}
        <span className="ml-auto inline-flex items-center gap-1" title={thread ? `T3 thread: ${thread.title} (${thread.state})` : 'No T3 thread'}>
          {thread ? <><StatusGlyph status={THREAD_GLYPH[thread.state]} className="size-3" />thread</> : 'no thread'}
        </span>
      </span>
      <span className="pointer-events-none relative line-clamp-2 text-[13px] font-medium leading-snug"><ItemTitle item={item} /></span>
      <AzureFields azure={item.azure} />
      {item.slices.length > 0 && <span className="pointer-events-none relative"><SliceBar item={item} /></span>}
      <span className="pointer-events-none relative mt-auto flex items-center gap-1.5 text-xs">
        <ItemStatusGlyph item={item} className="size-3" />{item.status}
        {thread && <span className="truncate text-(--muted-foreground)">· {thread.state}</span>}
      </span>
      {action && <span className="relative flex min-h-6 min-w-0 items-center">{action}</span>}
    </div>
  );
}

function CheckNode({ check, width, after }: { check: EndToEndCheck; width: number; after: string }) {
  return (
    <div style={{ width, height: NODE_H }} data-map-check className="flex flex-col gap-1 rounded-lg border-2 border-dashed border-(--input) bg-(--card) px-2.5 py-2 shadow-xs">
      <span className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)"><FlaskConical className="size-3.5" />end-to-end check</span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug">{check.title}</span>
      <span className="mt-auto flex items-center gap-1.5 text-xs"><StatusGlyph status="Queued" className="size-3" />waiting · {check.steps.length} steps</span>
      <span className="text-[11px] text-(--muted-foreground)">agents run it once {after} land</span>
    </div>
  );
}

/** The map of `parts`, ending in `check`; a dossier with no check written ends in a note saying so. */
export function WorkMap({ parts, check, data, now }: { parts: Part[]; check: EndToEndCheck | undefined; data: BoardData; now: number }) {
  const { ref: box, width } = useWidth();
  const [hover, setHover] = useState<string | null>(null);
  const marker = useId().replace(/[^a-zA-Z0-9]/g, '');
  const m = layout(parts, data, width);
  const at = new Map(m.placed.map((p) => [p.key, p]));
  const near = (key: string) => !hover || key === hover || m.edges.some((e) => (e.from === hover && e.to === key) || (e.to === hover && e.from === key));
  const builds = parts.filter((p) => p.kind === 'build').map((p) => ref(p.item)).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const inCol = (c: number) => m.placed.filter((p) => p.col === c && p.part).length;
  return (
    <div ref={box} className="overflow-x-auto rounded-lg border border-(--border) bg-(--background)" data-work-map>
      <div className="relative" style={{ width: m.width, height: m.height }}>
        {m.bands.map((b, n) => (
          <div key={b.lane} className={`absolute left-0 border-t border-(--border) ${n % 2 ? 'bg-[color-mix(in_srgb,var(--muted)_50%,transparent)]' : ''}`} style={{ top: b.top, height: b.height, width: m.width }}>
            <div className="sticky left-0 flex h-full flex-col justify-center gap-0.5 bg-[color-mix(in_srgb,var(--background)_85%,transparent)] px-3" style={{ width: LABEL_W }}>
              <span className="flex items-center gap-1.5 text-xs font-medium">
                {b.lane === DECISIONS && <Lightbulb className="size-3.5 text-(--muted-foreground)" />}{b.lane === DECISIONS ? b.lane : repoName(b.lane, data.repos)}
              </span>
              {b.lane === DECISIONS
                ? <span className="text-[11px] text-(--muted-foreground)">grill, prototype, research</span>
                : repoName(b.lane, data.repos) !== b.lane && <span className="truncate text-[11px] text-(--muted-foreground)" title={b.lane}>{b.lane}</span>}
            </div>
          </div>
        ))}
        {Array.from({ length: m.cols }, (_, c) => (
          <span key={c} className="absolute flex h-7.5 items-center gap-1 text-[11px] text-(--muted-foreground)" style={{ left: LABEL_W + c * m.colW + 14 }}>
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
            const done = !!a.part && isDone(a.part.item);
            const x1 = a.x + m.nodeW, y1 = a.y + NODE_H / 2, x2 = b.x - 2, y2 = b.y + NODE_H / 2, mid = (x1 + x2) / 2;
            // Over a column, the arrow leaves from the node's foot and runs in the gap under the row, not behind a node.
            const sx = x1 - 20, wy = a.y + NODE_H + GAP / 2;
            const d = b.col - a.col > 1
              ? `M${sx} ${a.y + NODE_H} L${sx} ${wy - 6} Q${sx} ${wy} ${sx + 6} ${wy} L${x2 - 30} ${wy} C${x2 - 12} ${wy} ${x2 - 18} ${y2} ${x2} ${y2}`
              : `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
            const lit = !!hover && (e.from === hover || e.to === hover);
            return (
              <path key={`${e.from}-${e.to}`} d={d} fill="none" data-edge={`${e.from} ${e.to}`}
                stroke={done ? 'var(--st-done)' : 'var(--muted-foreground)'} strokeWidth={lit ? 2.5 : 1.5} strokeDasharray={done ? undefined : '5 4'}
                opacity={hover && !lit ? 0.2 : done ? 0.7 : 0.9} markerEnd={`url(#${marker}-${done ? 'done' : 'open'})`} />
            );
          })}
        </svg>
        {m.placed.map((p) => (
          <div key={p.key} className={`absolute transition-opacity ${near(p.key) ? '' : 'opacity-40'}`} style={{ left: p.x, top: p.y }}
            onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
            {p.part
              ? <PartNode part={p.part} data={data} now={now} width={m.nodeW} />
              : check
                ? <CheckNode check={check} width={m.nodeW} after={builds} />
                : <div style={{ width: m.nodeW, height: NODE_H }} className="grid place-items-center rounded-lg border-2 border-dashed border-(--input) p-3 text-center text-xs text-(--muted-foreground)">No end-to-end check written yet</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
