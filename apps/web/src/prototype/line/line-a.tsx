// PROTOTYPE, throwaway. Line variant A, "Stage list": the line read top to bottom in #167's stages (Refining, Ready to
// build, Building, Review, Verify & merge), each a header with its count over full-width rows. A row gives an item
// two lines, its repo, number, title, age and next action, then its status, slices, PRs with checks, thread and
// agent time; opened, it shows its track, slices and PRs. A concept, or a parent whose builds span repos, takes the
// width as one block in its parent's stage (see line-a-concept.tsx), its sub-issues inside it, not loose rows; each
// stage names the ones it holds there. Stages, rows and blocks all fold.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { CornerDownRight, GitPullRequest, MessagesSquare, Play } from 'lucide-react';
import { byFlowOrder, checksBadge, duration, kindLabel, platformOf, prLabel, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { Button, STATUS_COLOR, StatusGlyph } from '../chrome.tsx';
import { ActionButtons, ItemTitle, PrList, SliceBar, SliceList, StepTrack, hint, statsOf } from '../item-bits.tsx';
import type { Pick } from '../list-sidebar.tsx';
import type { LineProps } from './line-data.ts';
import { Chevron, ConceptBlock, RepoMark, childrenOf, conceptOf, mockOf, picked } from './line-a-concept.tsx';

export const NAME = 'Stage list';

const STAGES: { name: string; statuses: Status[]; hint: string }[] = [
  { name: 'Refining', statuses: ['Queued', 'Shaping'], hint: 'a skill asks the questions until the brief passes' },
  { name: 'Ready to build', statuses: ['Ready'], hint: 'refined; press Start when you want it built' },
  { name: 'Building', statuses: ['In progress'], hint: 'build threads work through the slices' },
  { name: 'Review', statuses: ['Review'], hint: 'reviewers check the diff, the approver opens the PR' },
  { name: 'Verify & merge', statuses: ['Verify', 'Ready to merge'], hint: 'yours: try it, then merge' },
];

/** What the item's T3 thread is doing, read from its status. */
const THREAD: Partial<Record<Status, string>> = {
  Queued: 'no thread yet', Shaping: 'shaping thread running', Ready: 'no thread until Start', 'In progress': 'build thread running',
  Review: 'reviewers running', Verify: 'thread waits on you', 'Ready to merge': 'thread done',
};

const isGroup = (i: Item, all: Item[]) => i.labels.includes('concept') || !!mockOf(i) || childrenOf(i, all).length > 0;

function Facts({ item, now, pick, data }: { item: Item; now: number; pick: Pick; data: BoardData }) {
  const s = statsOf(item);
  const done = item.slices.filter((x) => x.progress === 'done').length;
  const active = item.slices.filter((x) => x.progress === 'active').length;
  const concept = conceptOf(item);
  const parent = concept ? data.items.find((i) => i.number === Number(concept)) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[52px] text-xs text-(--muted-foreground)">
      <span className="font-medium" style={{ color: item.status === 'Verify' ? 'var(--warning-foreground)' : 'var(--foreground)' }}>{item.status}</span>
      <span>{kindLabel(item)}</span>
      {item.slices.length > 0 && (
        <span className="inline-flex items-center gap-2"><span className="w-24 @min-[720px]:w-36"><SliceBar item={item} /></span><span className="tabular-nums">{done}/{item.slices.length} slices{active ? ` · ${active} active` : ''}</span></span>
      )}
      {item.linkedPrs.map((pr) => {
        const b = checksBadge(pr, now);
        return (
          <span key={pr.number} title={b?.title} className="inline-flex items-center gap-1">
            <GitPullRequest className="size-3" />{prLabel(pr)}
            {b && <><span className="size-1.5 rounded-full" style={{ background: b.className.includes('failed') ? 'var(--error)' : b.className.includes('running') ? 'var(--warning)' : 'var(--st-done)' }} />{b.text}</>}
          </span>
        );
      })}
      {THREAD[item.status] && <span className="inline-flex items-center gap-1"><MessagesSquare className="size-3" />{THREAD[item.status]}</span>}
      {s && <span className="tabular-nums">agent {duration(s.agentMs)}</span>}
      {item.blockedBy > 0 && <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)">blocked by {item.blockedBy}</span>}
      {parent && (
        <button type="button" onClick={(e) => { e.stopPropagation(); pick.set(parent.id); }} className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 hover:bg-(--accent) hover:text-(--foreground)">
          <CornerDownRight className="size-3" />in concept #{parent.number}
        </button>
      )}
    </div>
  );
}

function Row({ item, data, now, pick, open, onToggle }: { item: Item; data: BoardData; now: number; pick: Pick; open: boolean; onToggle: () => void }) {
  const h = hint(item);
  return (
    <li onClick={() => pick.set(item.id)} className={`grid cursor-default gap-1 rounded-lg border border-(--border) bg-(--card) px-2.5 py-2 hover:bg-(--accent) ${picked(pick.id === item.id)}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Chevron open={open} onClick={onToggle} label={item.title} />
        <RepoMark platform={platformOf(item, data.repos)} />
        <StatusGlyph status={item.status} />
        <button type="button" onClick={(e) => { e.stopPropagation(); pick.set(item.id); }} className="min-w-0 flex-1 truncate text-left font-medium"><ItemTitle item={item} /></button>
        <span className="shrink-0 text-[11px] tabular-nums text-(--muted-foreground)">{shortAgo(item.updatedAt, now)}</span>
        <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {item.status === 'Ready' ? (item.blockedBy ? <span className="text-xs text-(--muted-foreground)">waits on {item.blockedBy}</span> : <Button primary small><Play />Start</Button>) : <ActionButtons item={item} small />}
        </span>
      </div>
      <Facts item={item} now={now} pick={pick} data={data} />
      {open && (
        <div className="mt-2 grid gap-3 pl-[52px]" onClick={(e) => e.stopPropagation()}>
          <StepTrack status={item.status} labels />
          {h && <p className="m-0 flex items-center gap-2 text-[13px] text-(--warning-foreground)"><StatusGlyph status={item.status} />{h}</p>}
          {item.slices.length > 0 && <SliceList item={item} />}
          {item.linkedPrs.length > 0 && <PrList item={item} />}
          {!item.slices.length && !item.linkedPrs.length && <p className="m-0 text-xs text-(--muted-foreground)">No slices or pull requests yet.</p>}
        </div>
      )}
    </li>
  );
}

function Stage({ name, statuses, hint: why, count, open, onToggle, children }: { name: string; statuses: Status[]; hint: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid gap-1.5 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 gap-0.5">{statuses.map((s) => <StatusGlyph key={s} status={s} />)}</span>
          <span className="shrink-0 text-[13px] font-semibold">{name}</span>
          <span className="shrink-0 text-xs tabular-nums text-(--muted-foreground)">{count}</span>
          <span className="min-w-0 truncate text-xs text-(--muted-foreground)">· {statuses.join(', ')} · {why}</span>
          <span className="ml-auto shrink-0 text-(--muted-foreground)">{open ? '−' : '+'}</span>
        </span>
        <span className="h-0.5 rounded-full" style={{ background: STATUS_COLOR[statuses[statuses.length - 1]!], opacity: count ? 1 : 0.25 }} />
      </button>
      {open && children}
    </section>
  );
}

export function LineA({ items, data, now, pick }: LineProps) {
  // Ids whose fold differs from the default: stages and blocks start open, rows closed.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setFlipped((f) => { const n = new Set(f); if (!n.delete(key)) n.add(key); return n; });
  const isOpen = (key: string, byDefault: boolean) => byDefault !== flipped.has(key);
  const shown = new Set(items.map((i) => i.id));
  // A block shows when its parent or any of its sub-issues is in the picked repo: the Apple repo still sees #180.
  const groups = data.items.filter((g) => STAGES.some((st) => st.statuses.includes(g.status)) && isGroup(g, data.items) && (shown.has(g.id) || childrenOf(g, data.items).some((c) => shown.has(c.id))));
  const inside = new Map(groups.flatMap((g) => childrenOf(g, data.items).map((c) => [c.id, g] as const)));
  const loose = items.filter((i) => !inside.has(i.id) && !groups.includes(i)).sort(byFlowOrder);
  return (
    <div className="@container grid gap-5">
      {STAGES.map((st) => {
        const blocks = groups.filter((g) => st.statuses.includes(g.status));
        const rows = loose.filter((i) => st.statuses.includes(i.status));
        const held = items.filter((i) => inside.has(i.id) && st.statuses.includes(i.status));
        const key = `stage:${st.name}`;
        return (
          <Stage key={st.name} {...st} count={blocks.length + rows.length} open={isOpen(key, true)} onToggle={() => toggle(key)}>
            <div className="grid gap-2">
              {blocks.map((g) => <ConceptBlock key={g.id} item={g} data={data} now={now} pick={pick} open={isOpen(g.id, true)} onToggle={() => toggle(g.id)} />)}
              {rows.length > 0 && <ul className="m-0 grid list-none gap-1.5 p-0">{rows.map((i) => <Row key={i.id} item={i} data={data} now={now} pick={pick} open={isOpen(i.id, false)} onToggle={() => toggle(i.id)} />)}</ul>}
              {held.length > 0 && (
                <p className="m-0 flex flex-wrap items-center gap-1 text-xs text-(--muted-foreground)">
                  Also at this stage, inside {held.length > 1 ? 'their' : 'its'} concept:
                  {held.map((i) => (
                    <button key={i.id} type="button" onClick={() => pick.set(i.id)} className={`inline-flex min-w-0 items-center gap-1 rounded-md border border-(--border) px-1.5 py-0.5 hover:bg-(--accent) ${picked(pick.id === i.id)}`}>
                      <StatusGlyph status={i.status} className="size-3" /><span className="truncate"><ItemTitle item={i} /></span><span className="shrink-0">in #{inside.get(i.id)!.number}</span>
                    </button>
                  ))}
                </p>
              )}
              {!blocks.length && !rows.length && !held.length && <p className="m-0 rounded-lg border border-dashed border-(--input) px-3 py-2 text-xs text-(--muted-foreground)">Nothing here.</p>}
            </div>
          </Stage>
        );
      })}
    </div>
  );
}
