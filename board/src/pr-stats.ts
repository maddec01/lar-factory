// The item stats block the board keeps in the body of each open PR linked to an
// item. Pure: the server reads the bodies with the board query, reads each PR to
// edit again, and sends the edits.

import type { Item, ItemStats } from './model.ts';
import { duration, formatTokens } from './render.ts';

const START = '<!-- mux-stats -->';
const END = '<!-- /mux-stats -->';

const MIN = 60_000;

/**
 * Agent time rounded coarser than on cards, so a running turn doesn't rewrite the
 * PR body every refresh: to 5 minutes under an hour, to 15 from an hour.
 */
function roughDuration(ms: number): string {
  const step = ms < 60 * MIN ? 5 * MIN : 15 * MIN;
  return duration(Math.round(ms / step) * step);
}

/** The marked block: agent time, then total tokens. */
export function statsBlock(stats: ItemStats): string {
  return `${START}\n**Item stats** (kept current by the Mux board): agent time ${roughDuration(stats.agentMs)} · ${formatTokens(stats.tokens)} tokens\n${END}`;
}

// A marker counts only alone on its own line, so one quoted in prose isn't the block.
const START_LINE = /^<!-- mux-stats -->[ \t]*\r?$/gm;
const END_LINE = /^<!-- \/mux-stats -->[ \t]*\r?$/gm;

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
  const range = blockRange(body);
  // GitHub can send a body back with CRLF line ends; that block is still current.
  if (range && body.slice(...range).replaceAll('\r\n', '\n') === block) return null;
  return withStatsBlock(body, block);
}

export interface PrBodyEdit {
  url: string;
  /** The current block, to apply again to the PR's latest body before the edit is sent. */
  block: string;
  /** The new body, from the body the board read. */
  body: string;
}

/**
 * The open linked PRs whose block is missing or out of date, with their new bodies.
 * Items without stats, and PRs whose body wasn't read, are left alone. A PR linked
 * to several items takes the first item's stats, so the items don't take turns.
 * Only PRs in `repos`, the repos config.json lists, are edited: an issue can be
 * closed by a PR in a repo the board doesn't manage.
 */
export function prStatsEdits(items: readonly Item[], repos: readonly string[]): PrBodyEdit[] {
  const seen = new Set<string>();
  const edits: PrBodyEdit[] = [];
  for (const item of items) {
    const stats = item.stats;
    if (!stats || stats === 'unavailable') continue;
    for (const pr of item.linkedPrs) {
      if (pr.state !== 'OPEN' || pr.body === undefined || seen.has(pr.url)) continue;
      if (!repos.some((repo) => pr.url.startsWith(`https://github.com/${repo}/pull/`))) continue;
      seen.add(pr.url);
      const block = statsBlock(stats);
      const body = updatedBody(pr.body, block);
      if (body !== null) edits.push({ url: pr.url, block, body });
    }
  }
  return edits;
}
