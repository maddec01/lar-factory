// Builds a small T3 Code state database for tests: only the tables and columns item stats read.

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

export interface FixtureTurn {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number; usageStatus: string } | null;
}

export interface FixtureThread {
  id: string;
  /** User messages, earliest first; each a minute apart. */
  messages?: string[];
  title?: string;
  /** The root thread's id for a child thread; omitted for a root. */
  rootThreadId?: string;
  turns?: FixtureTurn[];
}

export interface FixtureRequest {
  turnId: string;
  createdAt: string;
  resolvedAt?: string | null;
}

const SCHEMA = `
CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, title TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_messages (message_id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, created_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_provider_turns (provider_turn_id TEXT PRIMARY KEY, thread_id TEXT, status TEXT, started_at TEXT, completed_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_runtime_requests (runtime_request_id TEXT PRIMARY KEY, thread_id TEXT, provider_turn_id TEXT, created_at TEXT, resolved_at TEXT);
`;

/** Writes the database to a temporary folder removed after the test, and returns its path. */
export function statsDb(t: TestContext, threads: FixtureThread[], requests: FixtureRequest[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'mux-stats-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'statev2.sqlite');
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const thread = db.prepare('INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?)');
  const message = db.prepare('INSERT INTO orchestration_v2_projection_messages VALUES (?, ?, ?, ?, ?)');
  const turn = db.prepare('INSERT INTO orchestration_v2_projection_provider_turns VALUES (?, ?, ?, ?, ?, ?)');
  const request = db.prepare('INSERT INTO orchestration_v2_projection_runtime_requests VALUES (?, ?, ?, ?, ?)');
  for (const th of threads) {
    const lineage = th.rootThreadId
      ? { parentThreadId: th.rootThreadId, relationshipToParent: 'subagent', rootThreadId: th.rootThreadId }
      : { parentThreadId: null, relationshipToParent: null, rootThreadId: th.id };
    thread.run(th.id, th.title ?? th.id, JSON.stringify({ id: th.id, title: th.title ?? th.id, lineage }));
    // Inserted latest first, so the reader has to order by time.
    [...(th.messages ?? [])].reverse().forEach((text, i, all) => {
      const at = new Date(Date.parse('2026-10-20T08:00:00Z') + (all.length - 1 - i) * 60_000).toISOString();
      message.run(`${th.id}:m${i}`, th.id, 'user', at, JSON.stringify({ role: 'user', text }));
    });
    message.run(`${th.id}:assistant`, th.id, 'assistant', '2026-10-20T07:00:00.000Z', JSON.stringify({ role: 'assistant', text: 'Build x/y#1' }));
    for (const tu of th.turns ?? []) {
      const completedAt = tu.completedAt ?? null;
      turn.run(tu.id, th.id, completedAt ? 'completed' : 'running', tu.startedAt, completedAt,
        JSON.stringify({ id: tu.id, ...(tu.usage ? { turnTokenUsage: tu.usage } : {}) }));
    }
  }
  requests.forEach((r, i) => request.run(`request-${i}`, 'unused', r.turnId, r.createdAt, r.resolvedAt ?? null));
  db.close();
  return path;
}
