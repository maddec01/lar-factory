// One API response's usage, as T3 Code counts it, and the helpers its Claude and
// Codex record rules share. Ported from pingdotgg/t3code main at
// f054d1b8018721bd997d99cbb918a7b17bf098a4: packages/provider-core/src/server/usage.ts
// (`parseTimestampMs`).

/** A record's tokens by category; reasoning is inside output, as T3 has it. */
export interface UsageTokenTotals {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export type UsageSpeed = 'standard' | 'fast' | 'ultrafast';

/** One API response's usage, as T3's `UsageRecord` for the Claude and Codex providers. */
export interface UsageRecord {
  provider: 'claude' | 'codex';
  timestampMs: number;
  model: string;
  sessionId: string;
  totals: UsageTokenTotals;
  /** The provider's own cost, when the transcript records one. */
  reportedCostUsd: number | null;
  speed: UsageSpeed;
  /** A Codex turn whose speed tier only T3's own history can tell. */
  unresolvedServiceTierTurnId?: string;
  /** Claude: `messageId:requestId`. Null when nothing identifies the record, so it is never deduped. */
  dedupeKey: string | null;
}

export function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

