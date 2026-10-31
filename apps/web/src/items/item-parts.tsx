// The bits every view draws for an item: its numbered title, title link, status track and slice bar, and the item
// dialog's repository tag, slices, pull requests, checks, and agent work. The tag is the design system's Badge; the
// board's CSS adds the coloured dot.

import { Check, GitPullRequest } from 'lucide-react';
import { STATUSES, UNREADABLE, checkState, duration, formatTokens, formatUsd, itemName, prLabel, ref, repoName, sameRepo } from '@lar-factory/shared';
import type { AzureWorkItem, Checks, Item, RepoConfig, SliceProgress, Status } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { useBoardStore } from '../board/board-store.ts';
import { PrReadiness } from './pr-readiness.tsx';
import { STATUS_COLOR } from './status-glyph.tsx';

const REPO_TONES = 8;

/** A repository's colour class: the palette entry for its place among the board's repositories, or the muted
 *  colour for a repository the board doesn't list. `repo` is a repository key. */
export function repoTone(repo: string, repos: readonly RepoConfig[]): string {
  const at = repos.findIndex((r) => sameRepo(r.repo, repo));
  return at < 0 ? 'repo-tone-none' : `repo-tone-${at % REPO_TONES}`;
}

/** The control room's repository badge, with a medium label. */
export function RepoTag({ repo, repos }: { repo: string; repos: readonly RepoConfig[] }) {
  return <Badge className={`repo-tag ${repoTone(repo, repos)} gap-1.5`}>{repoName(repo, repos)}</Badge>;
}

export function TitleLink({ item, className = 'title' }: { item: Item; className?: string }) {
  const text = <>{item.number ? <><span className="ref">{ref(item)}</span> </> : null}{item.title}</>;
  return item.url
    ? <a className={className} href={item.url} target="_blank" rel="noopener">{text}</a>
    : <span className={className}>{text}</span>;
}

/** An item's title with its ticket's number before it, muted, the way the board lists every item; captured work has no number. */
export function ItemTitle({ item }: { item: Item }) {
  return <>{item.number ? <><span className="font-normal text-(--muted-foreground) tabular-nums">{ref(item)}</span> </> : null}{item.title}</>;
}

/** Azure's type, state and assignee as one compact line beside factory status. */
export function AzureFields({ azure }: { azure: AzureWorkItem | undefined }) {
  if (!azure) return null;
  const text = [azure.type, azure.state, azure.assignee].filter(Boolean).join(' · ');
  return <span data-azure title={text} className="block min-w-0 truncate text-xs text-(--muted-foreground)">{text}</span>;
}

/** Ten steps as a track; the past filled, the current one in its colour. */
export function StepTrack({ status }: { status: Status }) {
  const at = STATUSES.indexOf(status);
  return (
    <ol className="m-0 flex list-none gap-[3px] p-0">
      {STATUSES.map((s, i) => (
        <li key={s} title={s} className="h-1.5 flex-1 rounded-full"
          style={{ background: i < at ? 'color-mix(in srgb, var(--foreground) 28%, transparent)' : i === at ? STATUS_COLOR[s] : 'var(--soft)' }} />
      ))}
    </ol>
  );
}

const SLICE_COLOR: Record<SliceProgress, string> = { done: 'var(--st-done)', active: 'var(--st-now)', blocked: 'var(--st-review)', waiting: 'var(--input)' };

/** A build's slices as one bar, a segment each, in their colours; the bar's waiting segments are faint. `thick` draws it as tall as a step of the item dialog's progress bar. */
export function SliceBar({ item, thick }: { item: Item; thick?: boolean }) {
  if (!item.slices.length) return null;
  return (
    <ol className="m-0 flex list-none gap-[2px] p-0">
      {item.slices.map((s, i) => (
        <li key={i} title={itemName(s)} className={`${thick ? 'h-1.5' : 'h-1'} flex-1 rounded-full ${s.progress === 'active' ? 'status-pulse' : ''}`}
          style={{ background: s.progress === 'waiting' ? 'var(--soft)' : SLICE_COLOR[s.progress] }} />
      ))}
    </ol>
  );
}

/** A slice's state as a ring: ticked when done, a pulsing dot while active. */
export function SliceMark({ progress }: { progress: SliceProgress }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]"
      style={{ borderColor: SLICE_COLOR[progress], background: progress === 'done' ? 'var(--st-done)' : 'transparent' }}>
      {progress === 'done' && <Check className="size-2.5 text-white" strokeWidth={3} />}
      {progress === 'active' && <span className="status-pulse size-1.5 rounded-full bg-(--st-now)" />}
    </span>
  );
}

export function SliceList({ item }: { item: Item }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
      {item.slices.map((s, i) => (
        <li key={i} className="flex items-start gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-(--soft)">
          <span className="mt-0.5"><SliceMark progress={s.progress} /></span>
          {s.number > 0 && <span className="shrink-0 text-(--muted-foreground) tabular-nums">#{s.number}</span>}
          <span className={`min-w-0 flex-1 wrap-anywhere ${s.progress === 'done' ? 'text-(--muted-foreground) line-through' : s.progress === 'active' ? 'font-medium' : ''}`}>{s.title}</span>
          <span className="mt-px shrink-0 text-[11px] text-(--muted-foreground)">{s.progress}</span>
        </li>
      ))}
    </ul>
  );
}

const CHECKS_COLOR = { failed: 'var(--error)', running: 'var(--warning)', passed: 'var(--st-done)' } as const;

/** A pull request's checks as a coloured dot and their state, with the passed count when `counts`; nothing when it has none. */
function ChecksBadge({ checks, counts }: { checks: Checks | null; counts?: boolean }) {
  const state = checkState(checks);
  if (!checks || !state) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-(--muted-foreground)">
      <span className="size-2 rounded-full" style={{ background: CHECKS_COLOR[state] }} />checks {state}{counts && <span className="tabular-nums">· {checks.passed}/{checks.total} passed</span>}
    </span>
  );
}

export function PrList({ item }: { item: Item }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-1 p-0">
      {item.linkedPrs.map((pr) => (
        <li key={pr.number} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-(--border) bg-(--card) px-3 py-2">
          <GitPullRequest className="size-4 shrink-0 text-(--st-done)" />
          <a href={pr.url} target="_blank" rel="noopener" className="min-w-0 flex-1 basis-24 font-medium wrap-anywhere hover:underline">{prLabel(pr)}</a>
          <ChecksBadge checks={pr.checks} />
          <PrReadiness item={item} pr={pr} />
        </li>
      ))}
    </ul>
  );
}

/** Cost, agent time, tokens and wall time as one small muted line, each named in the tooltip; nothing when no thread worked on the item or T3's database can't be read. */
export function AgentWork({ item, className = '' }: { item: Item; className?: string }) {
  const s = item.stats;
  if (!s || s === 'unavailable') return null;
  const figures: [label: string, value: string, unit: string][] = [];
  if (s.costUsd !== undefined) figures.push(['Cost', formatUsd(s.costUsd), '']);
  figures.push(['Agent time', duration(s.agentMs), ''], ['Tokens', formatTokens(s.tokens), ' tokens']);
  if (s.wallMs) figures.push(['Wall time', duration(s.wallMs), ' wall']);
  return (
    <p data-agent-work title={figures.map(([k, v]) => `${k} ${v}`).join(' · ')} className={`m-0 text-xs text-(--muted-foreground) tabular-nums ${className}`}>
      {figures.map(([, v, unit]) => v + unit).join(' · ')}
    </p>
  );
}

/** The line that says why there are no agent work figures: no T3 thread worked on the item, or T3's database can't be read. */
export function AgentWorkNote({ item }: { item: Item }) {
  const s = item.stats;
  const hasThread = Array.isArray(item.threads) && item.threads.length > 0;
  return s && s !== 'unavailable' ? null : <p className="m-0 text-xs text-(--muted-foreground)">{s ? UNREADABLE : hasThread ? 'Usage totals are still loading.' : 'No T3 thread has worked on this yet.'}</p>;
}

/** Kind and relationships remain visible before an issue is queued. */
export function ItemKind({ item }: { item: Item }) {
  const words: string[] = [];
  if (item.kind) words.push(item.kind === 'bug' ? 'Bug' : item.kind === 'feature' ? 'Feature' : item.kind === 'improvement' ? 'Improvement' : item.kind === 'concept' ? 'Concept' : item.kind === 'decision' ? 'Decision' : 'Work');
  const parentKind = useBoardStore((state) => state.data.items.find((parent) => Boolean(item.parentId && parent.id === item.parentId || item.parent?.url && parent.url === item.parent.url))?.kind);
  const parentIsConcept = item.tracker?.parent?.kind === 'concept' || parentKind === 'concept';
  if (parentIsConcept) words.push('Part of a concept');
  else if (item.parent) words.push('Part of another issue');
  if (item.tracker?.connections?.length || item.tracker?.dependencies?.length) words.push('Cross-repository');
  return words.length ? <span data-item-kind className="inline-flex flex-wrap gap-1">{words.map((word) => <Badge key={word}>{word}</Badge>)}</span> : null;
}

export function StructureSync({ item }: { item: Item }) {
  if (!item.sync || item.sync.state === 'saved') return null;
  return <span data-structure-sync title={item.sync.message} role={item.sync.state === 'error' || item.sync.state === 'conflict' ? 'status' : undefined}
    className="text-xs text-base-700">{item.sync.state === 'pending' ? 'Saving concept links…' : item.sync.state === 'conflict' ? 'Concept links changed on another machine' : 'Concept links could not save'}{item.sync.message && `. ${item.sync.message}`}</span>;
}
