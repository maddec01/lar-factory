// T3 Code's database, read-only: every query the board runs on
// T3's internal schema lives here, so a schema change touches one file. The Codex
// turn selections follow pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4:
// apps/server/src/usage/CodexUsageHistory.ts.

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { expandHome } from './t3-settings.ts';

/** Runs `read` on T3's database at `path`, opened read-only; throws when it is missing or can't be read. */
export function readT3Db<T>(path: string, read: (db: DatabaseSync) => T): T {
    const db = openT3Db(path);
    try {
        return read(db);
    } finally {
        db.close();
    }
}

/** T3's database at `path`, opened read-only, for a caller making several reads; it closes it. */
export const openT3Db = (path: string): DatabaseSync => new DatabaseSync(path, { readOnly: true });

// Each thread with its title, lineage and deletion time, and a root thread's first user message.
const THREADS = `
SELECT t.thread_id AS id, t.title, t.deleted_at AS deletedAt, json_extract(t.payload_json, '$.lineage.rootThreadId') AS root,
  json_extract(t.payload_json, '$.lineage.parentThreadId') AS parent,
  CASE WHEN json_extract(t.payload_json, '$.lineage.relationshipToParent') IS NULL THEN (
    SELECT json_extract(m.payload_json, '$.text') FROM orchestration_v2_projection_messages m
    WHERE m.thread_id = t.thread_id AND m.role = 'user' ORDER BY m.created_at LIMIT 1
  ) END AS text
FROM orchestration_v2_projection_threads t`;

// Each child thread's subagent runs. Claude's native subagents have no turns, so
// their run is their work; a child can have several rows (Codex app_owned).
// Never read updated_at, which T3 bulk-updates.
const RUNS = `
SELECT child_thread_id AS thread, started_at AS startedAt, completed_at AS completedAt
FROM orchestration_v2_projection_subagents WHERE child_thread_id IS NOT NULL`;

const TURNS = `
SELECT provider_turn_id AS id, thread_id AS thread, provider_thread_id AS providerThread,
  started_at AS startedAt, completed_at AS completedAt, status
FROM orchestration_v2_projection_provider_turns`;

const WAITS = `
SELECT provider_turn_id AS turn, created_at AS createdAt, resolved_at AS resolvedAt
FROM orchestration_v2_projection_runtime_requests`;

// Each thread's latest message, for capping a turn T3 never closed.
const LAST_MESSAGES = `
SELECT thread_id AS thread, max(created_at) AS at FROM orchestration_v2_projection_messages GROUP BY thread_id`;

// Provider threads with a turn in flight. A turn whose run failed can stay open
// for good, its provider thread back to idle.
const ACTIVE = `
SELECT provider_thread_id AS id FROM orchestration_v2_projection_provider_threads WHERE status = 'active'`;

/** A thread: its root and direct parent when it is a child, and its first user message when it is a root. */
interface ThreadRow {
    id: string;
    title: unknown;
    /** When T3 deleted the thread; null while it is live. */
    deletedAt: unknown;
    root: unknown;
    parent: unknown;
    text: unknown;
}

export interface TurnRow {
    id: string;
    thread: string;
    providerThread: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
}

/** A child thread's subagent run. */
interface RunRow {
    thread: string;
    startedAt: string | null;
    completedAt: string | null;
}

/** A turn's wait on a runtime request. */
interface WaitRow {
    turn: string;
    createdAt: string | null;
    resolvedAt: string | null;
}

/** A thread's latest message time. */
interface LastMessageRow {
    thread: string;
    at: string | null;
}

/** Everything agent time and item threads are read from. */
export interface ThreadRows {
    threads: ThreadRow[];
    turns: TurnRow[];
    runs: RunRow[];
    waits: WaitRow[];
    lastMessages: LastMessageRow[];
    /** The provider threads running a turn now. */
    active: Set<string>;
}

export function threadRows(db: DatabaseSync): ThreadRows {
    return {
        threads: db.prepare(THREADS).all() as unknown as ThreadRow[],
        turns: db.prepare(TURNS).all() as unknown as TurnRow[],
        runs: db.prepare(RUNS).all() as unknown as RunRow[],
        waits: db.prepare(WAITS).all() as unknown as WaitRow[],
        lastMessages: db.prepare(LAST_MESSAGES).all() as unknown as LastMessageRow[],
        active: activeProviderThreads(db),
    };
}

/** The provider threads running a turn now; none when T3 doesn't say, so open turns are capped. */
function activeProviderThreads(db: DatabaseSync): Set<string> {
    try {
        return new Set(
            (db.prepare(ACTIVE).all() as { id: unknown }[]).flatMap(({ id }) => (typeof id === 'string' ? [id] : [])),
        );
    } catch {
        return new Set();
    }
}

// Each provider thread's native session and provider instance, earliest first: a
// record forked threads share counts for the thread that produced it first. Never
// map through a turn's nativeTurnRef, which can hold a placeholder. Claude's
// provider_native child threads have no provider threads: their records are in
// their parent session's subagent transcripts. A Codex child thread has its own
// provider thread and rollout, whose copy of its parent's history isn't counted.
const SESSIONS = `
SELECT thread_id AS thread, json_extract(payload_json, '$.driver') AS driver,
  json_extract(payload_json, '$.providerInstanceId') AS instance,
  json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session
FROM orchestration_v2_projection_provider_threads
ORDER BY json_extract(payload_json, '$.createdAt'), rowid`;

/** A thread's native session, whose transcripts hold its usage, on a provider instance and driver. */
export interface ThreadSession {
    thread: string;
    driver: unknown;
    instance: string;
    session: string;
}

/** Each provider thread's session, earliest first, leaving out any T3 doesn't fully record. */
export function threadSessions(db: DatabaseSync): ThreadSession[] {
    return (
        db.prepare(SESSIONS).all() as { thread: unknown; driver: unknown; instance: unknown; session: unknown }[]
    ).flatMap(({ thread, driver, instance, session }) =>
        typeof thread === 'string' && typeof session === 'string' && typeof instance === 'string'
            ? [{ thread, driver, instance, session }]
            : [],
    );
}

// Each Codex turn's model selection when its attempt started running, before any
// steering changed it, as T3's CodexUsageHistory.ts reads it.
const CODEX_TURN_SELECTIONS = `
SELECT json_extract(attempt.payload_json, '$.nativeThreadId') AS nativeThread,
  json_extract(turn.payload_json, '$.nativeTurnRef.nativeId') AS nativeTurn,
  (
    SELECT json_extract(event.payload_json, '$.modelSelection')
    FROM orchestration_events AS event
    WHERE event.aggregate_kind = 'thread'
      AND event.application_event_version = 2
      AND event.stream_id = attempt.thread_id
      AND event.event_type = 'run.updated'
      AND json_extract(event.payload_json, '$.id') = attempt.run_id
      AND json_extract(event.payload_json, '$.activeAttemptId') = attempt.attempt_id
      AND json_extract(event.payload_json, '$.status') = 'running'
    ORDER BY event.sequence
    LIMIT 1
  ) AS selection
FROM orchestration_v2_projection_provider_turns AS turn
LEFT JOIN orchestration_v2_projection_run_attempts AS attempt
  ON attempt.attempt_id = turn.run_attempt_id
  AND attempt.thread_id = turn.thread_id
  AND attempt.provider_thread_id = turn.provider_thread_id
WHERE json_extract(turn.payload_json, '$.nativeTurnRef.driver') = 'codex'
  AND json_extract(turn.payload_json, '$.nativeTurnRef.nativeId') IN (SELECT value FROM json_each(?))`;

/** A Codex turn's session and the model selection its attempt started with, as JSON. */
export interface CodexTurnSelection {
    nativeThread: unknown;
    nativeTurn: unknown;
    selection: unknown;
}

/** The selections of the Codex turns with these native turn IDs; a turn ID can be on several rows. */
export function codexTurnSelections(db: DatabaseSync, turnIds: Iterable<string>): CodexTurnSelection[] {
    return db.prepare(CODEX_TURN_SELECTIONS).all(JSON.stringify([...turnIds])) as unknown as CodexTurnSelection[];
}

// T3's live projects and their folders.
const PROJECTS = `SELECT project_id AS id, title, workspace_root AS root FROM projection_projects WHERE deleted_at IS NULL`;

/**
 * T3's live projects with their titles, each folder with `~` expanded and no trailing slash. Unlike
 * stats, this doesn't fail soft: it throws when the database is missing or can't
 * be read, e.g. T3 changed its schema.
 */
export function liveProjects(db: string, home: string): { id: string; title: string; folder: string }[] {
    return readT3Db(db, (open) =>
        (open.prepare(PROJECTS).all() as { id: unknown; title: unknown; root: unknown }[]).flatMap(
            ({ id, title, root }) =>
                typeof id === 'string' && typeof root === 'string'
                    ? [{ id, title: typeof title === 'string' ? title : id, folder: normalPath(root, home) }]
                    : [],
        ),
    );
}

/** The project row's default model selection, which T3 still applies before its settings are folded; null when it has none. */
export function projectDefaultSelection(db: DatabaseSync, projectId: string): unknown {
    const row = db
        .prepare(
            'SELECT default_model_selection_json AS selection FROM projection_projects WHERE project_id = ? AND deleted_at IS NULL',
        )
        .get(projectId) as { selection: unknown } | undefined;
    return typeof row?.selection === 'string' ? (JSON.parse(row.selection) as unknown) : null;
}

// A project's live threads with a title, newest first, each with its latest assistant message.
const THREAD_BY_TITLE = `
SELECT t.thread_id AS id, (
  SELECT json_extract(m.payload_json, '$.text') FROM orchestration_v2_projection_messages m
  WHERE m.thread_id = t.thread_id AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1
) AS latest
FROM orchestration_v2_projection_threads t
WHERE t.project_id = ? AND t.title = ? AND t.deleted_at IS NULL
ORDER BY t.created_at DESC LIMIT 1`;

/** The project's newest live thread with this title and its latest assistant message, or null when it has none; throws like liveProjects. */
export function threadByTitle(
    db: string,
    projectId: string,
    title: string,
): { threadId: string; latest: string | null } | null {
    const row = readT3Db(db, (open) => open.prepare(THREAD_BY_TITLE).get(projectId, title)) as
        | { id: unknown; latest: unknown }
        | undefined;
    if (typeof row?.id !== 'string') return null;
    return { threadId: row.id, latest: typeof row.latest === 'string' ? row.latest : null };
}

// A run with work under way.
const LIVE_RUN = `('preparing', 'starting', 'running', 'waiting')`;
const TOOL_ITEMS = `('command_execution', 'dynamic_tool', 'file_change', 'web_search')`;

// A thread's turn items, which can be many and large: every read walks its index
// on (thread_id, ordinal, turn_item_id) or its partial one on unfinished items and
// stops at a limit, and reads only the fields it names from each row it returns.
const ACTIVITY_ITEM = `
SELECT i.type, i.status, (SELECT r.status IN ${LIVE_RUN} FROM orchestration_v2_projection_runs r WHERE r.run_id = i.run_id) AS runLive,
  json_extract(i.payload_json, '$.title') AS title, substr(json_extract(i.payload_json, '$.input'), 1, 2000) AS input,
  json_extract(i.payload_json, '$.toolName') AS toolName, json_extract(i.payload_json, '$.fileName') AS fileName,
  json_extract(i.payload_json, '$.streaming') AS streaming, json_extract(i.payload_json, '$.startedAt') AS startedAt,
  json_extract(i.payload_json, '$.completedAt') AS completedAt, json_extract(i.payload_json, '$.updatedAt') AS updatedAt
FROM orchestration_v2_projection_turn_items i`;
const NEWEST_TOOL = `${ACTIVITY_ITEM} WHERE i.thread_id = ? AND i.type IN ${TOOL_ITEMS} ORDER BY i.ordinal DESC, i.turn_item_id DESC LIMIT 1`;
const NEWEST_TEXT = `${ACTIVITY_ITEM} WHERE i.thread_id = ? AND i.type IN ('reasoning', 'assistant_message') ORDER BY i.ordinal DESC, i.turn_item_id DESC LIMIT 1`;
const UNFINISHED_TOOLS = `${ACTIVITY_ITEM} WHERE i.thread_id = ? AND i.status IN ('pending', 'running', 'waiting') AND i.type IN ${TOOL_ITEMS} ORDER BY i.ordinal DESC, i.turn_item_id DESC LIMIT 20`;

/** A turn item as thread activity reads it. `runLive` is 1 or 0 by the item's run, and null for an item with no run, as a native subagent's are. */
export interface ActivityItemRow {
    type: string;
    status: string;
    runLive: number | null;
    title: string | null;
    input: string | null;
    toolName: string | null;
    fileName: string | null;
    streaming: number | null;
    startedAt: string | null;
    completedAt: string | null;
    updatedAt: string | null;
}

/** A thread's newest tool, its newest text and every tool that still reads unfinished, however old. */
export function activityItems(db: DatabaseSync, threadId: string): ActivityItemRow[] {
    return [NEWEST_TOOL, NEWEST_TEXT, UNFINISHED_TOOLS].flatMap(
        (query) => activityStatement(db, query).all(threadId) as unknown as ActivityItemRow[],
    );
}

/** Only the four fixed activity queries are cached, by connection. Results are read afresh on every call. */
const activityStatements = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function activityStatement(db: DatabaseSync, query: string): StatementSync {
    let statements = activityStatements.get(db);
    if (!statements) {
        statements = new Map();
        activityStatements.set(db, statements);
    }
    let statement = statements.get(query);
    if (!statement) {
        statement = db.prepare(query);
        statements.set(query, statement);
    }
    return statement;
}

// A thread's subagent records that have not finished, with the state of the run
// that started each and of the child thread's own runs. Claude's and Codex's native
// subagents have no runs of their own, and a child task's outlive the run that started it.
const WORKING_AGENTS = `
SELECT s.child_thread_id AS child, json_extract(s.payload_json, '$.title') AS title, json_extract(s.payload_json, '$.model') AS model,
  s.started_at AS startedAt, (SELECT r.status IN ${LIVE_RUN} FROM orchestration_v2_projection_runs r WHERE r.run_id = s.run_id) AS runLive,
  (SELECT max(r.status IN ${LIVE_RUN}) FROM orchestration_v2_projection_runs r WHERE r.thread_id = s.child_thread_id) AS childRunLive
FROM orchestration_v2_projection_subagents s
WHERE s.thread_id = ? AND s.child_thread_id IS NOT NULL AND s.status NOT IN ('completed', 'failed', 'cancelled', 'interrupted')
ORDER BY s.started_at, s.subagent_id`;

/** An unfinished subagent record. `runLive` and `childRunLive` are 1 or 0, or null with no such run. */
export interface ActivityAgentRow {
    child: string;
    title: string | null;
    model: string | null;
    startedAt: string | null;
    runLive: number | null;
    childRunLive: number | null;
}

/** The subagent records of `threadId` that have not finished, oldest first. */
export function unfinishedAgents(db: DatabaseSync, threadId: string): ActivityAgentRow[] {
    return activityStatement(db, WORKING_AGENTS).all(threadId) as unknown as ActivityAgentRow[];
}

/** A folder with `~` expanded and no trailing slash. */
function normalPath(path: string, home: string): string {
    return expandHome(path, home).replace(/(?<=.)\/+$/, '');
}
