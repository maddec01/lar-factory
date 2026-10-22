// Builds a small T3 Code state database and Claude Code transcripts folder for tests:
// only the tables, columns and records item stats read.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

export interface FixtureTurn {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number; usageStatus: string } | null;
  /** An open turn whose run T3 gave up on: its provider thread is idle, not active. */
  abandoned?: boolean;
  /** A provider thread shared with the thread's other turns that name it; by default the turn's own. */
  providerThread?: string;
}

export interface FixtureThread {
  id: string;
  /** User messages, earliest first; each a minute apart. */
  messages?: string[];
  title?: string;
  /** The root thread's id for a child thread; omitted for a root. */
  rootThreadId?: string;
  turns?: FixtureTurn[];
  /** Claude session IDs of the thread's provider threads. */
  sessions?: string[];
}

export interface FixtureRequest {
  turnId: string;
  createdAt: string;
  resolvedAt?: string | null;
}

const SCHEMA = `
CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, title TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_messages (message_id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, created_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_provider_turns (provider_turn_id TEXT PRIMARY KEY, thread_id TEXT, provider_thread_id TEXT, status TEXT, started_at TEXT, completed_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_runtime_requests (runtime_request_id TEXT PRIMARY KEY, thread_id TEXT, provider_turn_id TEXT, created_at TEXT, resolved_at TEXT);
CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT PRIMARY KEY, thread_id TEXT, provider TEXT, status TEXT, payload_json TEXT);
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
  const turn = db.prepare('INSERT INTO orchestration_v2_projection_provider_turns VALUES (?, ?, ?, ?, ?, ?, ?)');
  const request = db.prepare('INSERT INTO orchestration_v2_projection_runtime_requests VALUES (?, ?, ?, ?, ?)');
  const provider = db.prepare('INSERT INTO orchestration_v2_projection_provider_threads VALUES (?, ?, ?, ?, ?)');
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
    for (const session of th.sessions ?? []) {
      provider.run(`${th.id}:${session}`, th.id, 'claudeAgent', 'idle',
        JSON.stringify({ appThreadId: th.id, nativeThreadRef: { driver: 'claudeAgent', nativeId: session, strength: 'strong' } }));
    }
    // A provider thread is active while any of its turns is open and not abandoned.
    const providerThreads = new Map<string, boolean>();
    for (const tu of th.turns ?? []) {
      const completedAt = tu.completedAt ?? null;
      const providerThread = `${th.id}:${tu.providerThread ?? tu.id}`;
      providerThreads.set(providerThread, (providerThreads.get(providerThread) ?? false) || !(completedAt || tu.abandoned));
      turn.run(tu.id, th.id, providerThread, completedAt ? 'completed' : 'running', tu.startedAt, completedAt,
        JSON.stringify({ id: tu.id, ...(tu.usage ? { turnTokenUsage: tu.usage } : {}) }));
    }
    for (const [providerThread, active] of providerThreads) {
      provider.run(providerThread, th.id, 'claudeAgent', active ? 'active' : 'idle', JSON.stringify({ appThreadId: th.id }));
    }
  }
  requests.forEach((r, i) => request.run(`request-${i}`, 'unused', r.turnId, r.createdAt, r.resolvedAt ?? null));
  db.close();
  return path;
}

/** An assistant record for message `id`, shaped like a Claude Code transcript's. */
export function assistant(id: string, input: number, cacheCreation: number, cacheRead: number, output: number): object {
  return { type: 'assistant', isSidechain: true, message: { id, role: 'assistant', usage: {
    input_tokens: input, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead, output_tokens: output,
  } } };
}

/**
 * Writes a Claude Code projects folder to a temporary root removed after the test, and returns the root.
 * `subagents` maps a session ID to its subagents' transcript lines by agent ID (a string is written as is);
 * `main` maps a session ID to its own transcript.
 */
export function transcriptsDir(t: TestContext, subagents: Record<string, Record<string, (object | string)[]>>,
  main: Record<string, object[]> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'mux-transcripts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, '-Users-pedro--t3-worktrees-mux-factory-feat-60');
  mkdirSync(project);
  const lines = (records: (object | string)[]) => records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
  for (const [session, records] of Object.entries(main)) writeFileSync(join(project, `${session}.jsonl`), lines(records));
  for (const [session, agents] of Object.entries(subagents)) {
    const dir = join(project, session, 'subagents');
    mkdirSync(dir, { recursive: true });
    for (const [agent, records] of Object.entries(agents)) {
      writeFileSync(join(dir, `agent-${agent}.meta.json`), JSON.stringify({ agentType: 'general-purpose' }));
      writeFileSync(join(dir, `agent-${agent}.jsonl`), lines(records));
    }
  }
  return root;
}
