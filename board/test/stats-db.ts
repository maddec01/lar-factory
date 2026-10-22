// Builds a small T3 Code state database, T3 settings and Claude Code homes for tests:
// only the tables, columns, settings and records item stats read.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

export interface FixtureTurn {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  /** An open turn whose run T3 gave up on: its provider thread is idle, not active. */
  abandoned?: boolean;
  /** A provider thread shared with the thread's other turns that name it; by default the turn's own. */
  providerThread?: string;
}

/** A provider thread on a native session: a Claude session ID, on instance `claudeAgent` unless named. */
export interface FixtureSession {
  session: string;
  instance?: string;
  driver?: string;
  /** When T3 created the provider thread; the earliest thread owns a record forks share. */
  createdAt?: string;
}

export interface FixtureThread {
  id: string;
  /** User messages, earliest first; each a minute apart. */
  messages?: string[];
  title?: string;
  /** The root thread's id for a child thread; omitted for a root. */
  rootThreadId?: string;
  turns?: FixtureTurn[];
  /** The thread's provider threads by native session. */
  sessions?: (string | FixtureSession)[];
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
    for (const entry of th.sessions ?? []) {
      const { session, instance = 'claudeAgent', driver = 'claudeAgent', createdAt = '2026-10-20T08:00:00.000Z' } =
        typeof entry === 'string' ? { session: entry } : entry;
      provider.run(`${th.id}:${session}`, th.id, instance, 'idle', JSON.stringify({ appThreadId: th.id, driver,
        providerInstanceId: instance, nativeThreadRef: { driver, nativeId: session, strength: 'strong' }, createdAt }));
    }
    // A provider thread is active while any of its turns is open and not abandoned.
    const providerThreads = new Map<string, boolean>();
    for (const tu of th.turns ?? []) {
      const completedAt = tu.completedAt ?? null;
      const providerThread = `${th.id}:${tu.providerThread ?? tu.id}`;
      providerThreads.set(providerThread, (providerThreads.get(providerThread) ?? false) || !(completedAt || tu.abandoned));
      // T3's own token counts, which item stats no longer read.
      turn.run(tu.id, th.id, providerThread, completedAt ? 'completed' : 'running', tu.startedAt, completedAt,
        JSON.stringify({ id: tu.id, turnTokenUsage: { inputTokens: 999, cachedInputTokens: 0, outputTokens: 9, usageStatus: 'complete' } }));
    }
    for (const [providerThread, active] of providerThreads) {
      provider.run(providerThread, th.id, 'claudeAgent', active ? 'active' : 'idle', JSON.stringify({ appThreadId: th.id }));
    }
  }
  requests.forEach((r, i) => request.run(`request-${i}`, 'unused', r.turnId, r.createdAt, r.resolvedAt ?? null));
  db.close();
  return path;
}

/** An assistant record for message `id`, shaped like a Claude Code transcript's, with request `req-<id>`. */
export function assistant(id: string, input: number, cacheCreation: number, cacheRead: number, output: number, model = 'claude-opus-4-1'): object {
  return { type: 'assistant', isSidechain: true, timestamp: '2026-10-20T09:05:00.000Z', requestId: `req-${id}`, sessionId: 'unused',
    message: { id, role: 'assistant', model, usage: {
      input_tokens: input, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead, output_tokens: output,
    } } };
}

/** A Claude session's transcripts: its own lines, and its subagents' by agent ID; a string is written as is. */
export interface FixtureTranscripts {
  main?: (object | string)[];
  subagents?: Record<string, (object | string)[]>;
}

/** A temporary folder removed after the test. */
export function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Writes a Claude Code home (its `projects` folder) and returns it: at `home`, or
 * in a temporary folder removed after the test.
 */
export function claudeHome(t: TestContext, sessions: Record<string, FixtureTranscripts>, home = tempDir(t, 'mux-claude-home-')): string {
  const project = join(home, 'projects', '-Users-pedro--t3-worktrees-mux-factory-feat-60');
  mkdirSync(project, { recursive: true });
  const lines = (records: (object | string)[]) => records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
  for (const [session, { main, subagents }] of Object.entries(sessions)) {
    if (main) writeFileSync(join(project, `${session}.jsonl`), lines(main));
    if (!subagents) continue;
    const dir = join(project, session, 'subagents');
    mkdirSync(dir, { recursive: true });
    for (const [agent, records] of Object.entries(subagents)) {
      writeFileSync(join(dir, `agent-${agent}.meta.json`), JSON.stringify({ agentType: 'general-purpose' }));
      writeFileSync(join(dir, `agent-${agent}.jsonl`), lines(records));
    }
  }
  return home;
}

/** Writes T3's settings with Claude provider instances by their `homePath`, and returns its path. */
export function t3Settings(t: TestContext, homes: Record<string, string>): string {
  const path = join(tempDir(t, 'mux-t3-settings-'), 'settings.json');
  const providerInstances = Object.fromEntries(Object.entries(homes).map(([id, homePath]) =>
    [id, { driver: 'claudeAgent', displayName: id, enabled: true, config: { homePath } }]));
  writeFileSync(path, JSON.stringify({ providerInstances, usageModelAliases: null, usagePriceOverrides: null }));
  return path;
}
