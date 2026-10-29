// The item stats block the board keeps in the body of each PR linked to a build.
// item. Pure: the server reads the bodies with the board query, reads each PR to
// edit again, and sends the edits.

import { isBuild, type Item, type ItemStats, duration, formatTokens, wholeUsd } from '@lar-factory/shared';

const START = '<!-- lar-stats -->';
const END = '<!-- /lar-stats -->';

const MIN = 60_000;

/**
 * Approximate display time: to 5 minutes under an hour, to 15 from an hour.
 * Exact figures live in the data comment; the server throttles edits while a build runs.
 */
function roughDuration(ms: number): string {
  const step = ms < 60 * MIN ? 5 * MIN : 15 * MIN;
  return duration(Math.round(ms / step) * step);
}

/**
 * The marked block, figures as on cards: agent time, wall time when measured, total
 * tokens, then API cost when any of the tokens could be priced, in whole dollars so
 * the PR stays readable. The server limits writes while a build runs.
 */
export function statsBlock(stats: ItemStats): string {
  const wall = stats.wallMs === undefined ? '' : ` · wall ${roughDuration(stats.wallMs)}`;
  const cost = stats.costUsd === undefined ? '' : ` · ${wholeUsd(stats.costUsd)}`;
  // Keep exact figures separate from the approximate figures people read.
  const exact = `<!-- lar-stats-data ${JSON.stringify({ agentMs: stats.agentMs, wallMs: stats.wallMs, tokens: stats.tokens, costUsd: stats.costUsd })} -->\n`;
  return `${START}\n**Item stats** (kept current by the lar board): Σ ${roughDuration(stats.agentMs)}${wall} · ${formatTokens(stats.tokens)}${cost}\n${exact}${END}`;
}

// A duration as roughDuration writes it, hours then minutes.
const DURATION = String.raw`(?:(\d+)h )?(\d+)m`;
// The figures line statsBlock writes: agent time, wall time if any, tokens with a
// K/M/B/T suffix, then the cost if any. Blocks from before wall time read
// `agent time 1h 0m · 12.4M tokens`.
const FIGURES = new RegExp(
  String.raw`(?:Σ|agent time) ${DURATION}(?: · wall ${DURATION})? · ([\d,.]+)([KMBT]?)(?: tokens)?(?: · (<\$1|\$[\d,]+))?\r?\n`,
);
const SUFFIX = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as const;

const minutes = (hours = '0', mins: string) => (Number(hours) * 60 + Number(mins)) * MIN;

/** The figures a body's block holds, as statsBlock wrote them, or null when it has no block or one that doesn't parse. */
function blockStats(body: string): ItemStats | null {
  const range = blockRange(body);
  const data = range && /^<!-- lar-stats-data (.+) -->\r?$/m.exec(body.slice(...range));
  if (data) {
    try {
      const value: unknown = JSON.parse(data[1]!);
      if (value && typeof value === 'object' && 'agentMs' in value && 'tokens' in value) {
        const s = value as ItemStats;
        if ([s.agentMs, s.tokens].every(validFigure) && [s.wallMs, s.costUsd].every((n) => n === undefined || validFigure(n))) {
          return { agentMs: s.agentMs, tokens: s.tokens, ...(s.wallMs === undefined ? {} : { wallMs: s.wallMs }),
            ...(s.costUsd === undefined ? {} : { costUsd: s.costUsd }), frozen: true };
        }
      }
    } catch { /* Older blocks still have readable display figures. */ }
  }
  const m = range && FIGURES.exec(body.slice(...range));
  if (!m) return null;
  const [, hours, mins, wallHours, wallMins, count, suffix, cost] = m;
  const tokens = Math.round(Number(count!.replaceAll(',', '')) * SUFFIX[suffix as keyof typeof SUFFIX]);
  if (!Number.isFinite(tokens)) return null;
  const stats: ItemStats = { agentMs: minutes(hours, mins!), tokens };
  if (wallMins) stats.wallMs = minutes(wallHours, wallMins);
  // Under a dollar reads back as 0, which writes `<$1` again.
  if (cost) stats.costUsd = cost === '<$1' ? 0 : Number(cost.slice(1).replaceAll(',', ''));
  stats.frozen = true;
  return stats;
}

const validFigure = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Stats are cumulative. A stale read or a missing transcript must not shrink known work. */
export function retainStats(known: Item['stats'], fresh: Item['stats']): Item['stats'] {
  if (!known || known === 'unavailable') return fresh;
  if (!fresh || fresh === 'unavailable') return known;
  const optionalMax = (a: number | undefined, b: number | undefined) => a === undefined ? b : b === undefined ? a : Math.max(a, b);
  const wallMs = optionalMax(known.wallMs, fresh.wallMs);
  const costUsd = optionalMax(known.costUsd, fresh.costUsd);
  return { agentMs: Math.max(known.agentMs, fresh.agentMs), tokens: Math.max(known.tokens, fresh.tokens),
    ...(wallMs === undefined ? {} : { wallMs }), ...(costUsd === undefined ? {} : { costUsd }) };
}

/**
 * A build's final figures from its most recently merged linked PR with a readable
 * block, refreshed from live and previously known stats before freezing, so stale
 * blocks and transcript deletion cannot shrink done items; null to use
 * live stats, as when an open linked PR is still being worked on, or for an item
 * that isn't a build, whose linked PR carries a build's figures.
 */
export function mergedStats(item: Item, live?: Item['stats']): ItemStats | null {
  if (!isBuild(item) || item.linkedPrs.some((pr) => pr.state === 'open')) return null;
  for (const pr of mergedPrs(item)) {
    const stats = pr.body === undefined ? null : blockStats(pr.body);
    if (stats) return { ...retainStats(stats, retainStats(item.stats, live)) as ItemStats, frozen: true };
  }
  return null;
}

const mergedPrs = (item: Item) => item.linkedPrs.filter((pr) => pr.state === 'merged')
  .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''));

// A marker counts only alone on its own line, so one quoted in prose isn't the block.
const START_LINE = /^<!-- lar-stats -->[ \t]*\r?$/gm;
const END_LINE = /^<!-- \/lar-stats -->[ \t]*\r?$/gm;

/** Where the body's block starts and ends, or null when it has none. */
function blockRange(body: string): [number, number] | null {
  START_LINE.lastIndex = 0;
  const start = START_LINE.exec(body);
  if (!start) return null;
  END_LINE.lastIndex = start.index + START.length;
  const end = END_LINE.exec(body);
  return end ? [start.index, end.index + END.length] : null;
}

/** The body with its block replaced, or with the block appended; the rest is kept byte for byte. */
export function withStatsBlock(body: string, block: string): string {
  const range = blockRange(body);
  if (range) return body.slice(0, range[0]) + block + body.slice(range[1]);
  return body ? `${body}\n\n${block}` : block;
}

/** The body with its block brought up to date, or null when the block is already current. */
export function updatedBody(body: string, block: string): string | null {
  const known = blockStats(body);
  const fresh = blockStats(block);
  if (known && fresh) {
    block = statsBlock(retainStats(known, fresh) as ItemStats);
  }
  const range = blockRange(body);
  // GitHub can send a body back with CRLF line ends; that block is still current.
  if (range && body.slice(...range).replaceAll('\r\n', '\n') === block) return null;
  return withStatsBlock(body, block);
}

/** A PR URL's owner/repo, lower-cased; empty for a URL that isn't a GitHub PR. */
const prRepo = (url: string) => /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1]?.toLowerCase() ?? '';

export interface PrBodyEdit {
  url: string;
  final: boolean;
  /** The current block, to apply again to the PR's latest body before the edit is sent. */
  block: string;
  /** The new body, from the body the board read. */
  body: string;
}

/**
 * Open PRs whose block is missing or out of date, and the merged PR whose final
 * figures grew. A build's PR carries its stats; other items linked to it, such
 * as a parent the PR also closes, write nothing. Builds without stats, and PRs whose
 * body wasn't read, are left alone; a PR is edited once even if two builds link it.
 * Only PRs in a repo with items on the board are edited: an issue can be closed by
 * a PR in a repo the board doesn't follow.
 */
export function prStatsEdits(items: readonly Item[]): PrBodyEdit[] {
  const repos = new Set(items.flatMap((item) => item.repo ? [item.repo.toLowerCase()] : []));
  const seen = new Set<string>();
  const edits: PrBodyEdit[] = [];
  for (const item of items) {
    const stats = item.stats;
    if (!isBuild(item) || !stats || stats === 'unavailable') continue;
    const finalPr = stats.frozen ? mergedPrs(item).find((pr) => pr.body !== undefined && blockStats(pr.body)) : undefined;
    for (const pr of item.linkedPrs) {
      if (pr.state === 'closed' || pr.body === undefined || seen.has(pr.url)) continue;
      if (pr.state === 'merged' && pr !== finalPr) continue;
      if (!repos.has(prRepo(pr.url))) continue;
      seen.add(pr.url);
      const final = pr.state === 'merged' || Array.isArray(item.threads) && item.threads.every((t) => t.state !== 'running');
      const stored = blockStats(pr.body);
      const kept = retainStats(stored ?? undefined, stats) as ItemStats;
      // Leave historical PRs alone when no fresh figure improves on their block.
      if (pr.state === 'merged' && stored && (['agentMs', 'wallMs', 'tokens', 'costUsd'] as const).every((k) => kept[k] === stored[k])) continue;
      const block = statsBlock(kept);
      const body = updatedBody(pr.body, block);
      if (body !== null) edits.push({ url: pr.url, final, block, body });
    }
  }
  return edits;
}
