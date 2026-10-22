// Claude in-thread subagent tokens (the Agent tool, which T3 doesn't count), read
// from Claude Code's transcripts: <root>/<cwd-slug>/<session>/subagents/agent-<id>.jsonl.
// Every read fails soft: a missing or garbled transcript only leaves tokens out.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Tokens } from './model.ts';

/** Subagent tokens over the given Claude session IDs; null when none has a subagent transcript. */
export type SubagentTokensReader = (sessions: Iterable<string>) => Tokens | null;

/** Claude Code's projects folder: `CLAUDE_PROJECTS_DIR`, or its usual place under the home folder. */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_PROJECTS_DIR || `${env.HOME ?? ''}/.claude-personal/projects`;
}

type Usage = Map<string, Tokens>;

// Each transcript's usage by message ID, kept until the file changes.
const cache = new Map<string, { mtimeMs: number; size: number; usage: Usage }>();

const SESSION = /^[\w-]+$/;
const TRANSCRIPT = /^agent-[\w-]+\.jsonl$/;

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** A token count read from untyped data; anything but a finite number counts as 0. */
export const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Each assistant message's usage, the last copy winning: transcripts repeat records. */
function parse(text: string): Usage {
  const usage: Usage = new Map();
  for (const line of text.split('\n')) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record || typeof record !== 'object' || (record as { type?: unknown }).type !== 'assistant') continue;
    const message = (record as { message?: { id?: unknown; usage?: Record<string, unknown> } }).message;
    if (typeof message?.id !== 'string' || !message.usage || typeof message.usage !== 'object') continue;
    const u = message.usage;
    const cached = count(u.cache_read_input_tokens);
    usage.set(message.id, {
      input: count(u.input_tokens) + cached + count(u.cache_creation_input_tokens),
      cached,
      output: count(u.output_tokens),
    });
  }
  return usage;
}

function transcriptUsage(path: string): Usage | null {
  try {
    const { mtimeMs, size } = statSync(path);
    const hit = cache.get(path);
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.usage;
    const usage = parse(readFileSync(path, 'utf8'));
    cache.set(path, { mtimeMs, size, usage });
    return usage;
  } catch {
    return null;
  }
}

/** Reads from the projects folder at `root`; its session folders are listed once, on first use. */
export function subagentTokens(root: string): SubagentTokensReader {
  let sessionDirs: Map<string, string> | undefined;
  const sessionDir = (session: string): string | undefined => {
    if (!sessionDirs) {
      sessionDirs = new Map();
      for (const project of list(root)) {
        for (const entry of list(join(root, project))) {
          if (SESSION.test(entry)) sessionDirs.set(entry, join(root, project, entry));
        }
      }
    }
    return sessionDirs.get(session);
  };

  return (sessions) => {
    const messages: Usage = new Map();
    let found = false;
    for (const session of new Set(sessions)) {
      const dir = SESSION.test(session) ? sessionDir(session) : undefined;
      if (!dir) continue;
      const subagents = join(dir, 'subagents');
      for (const file of list(subagents).filter((name) => TRANSCRIPT.test(name))) {
        const usage = transcriptUsage(join(subagents, file));
        if (!usage) continue;
        found = true;
        for (const [id, tokens] of usage) messages.set(id, tokens);
      }
    }
    if (!found) return null;
    const total: Tokens = { input: 0, cached: 0, output: 0 };
    for (const tokens of messages.values()) {
      total.input += tokens.input;
      total.cached += tokens.cached;
      total.output += tokens.output;
    }
    return total;
  };
}
