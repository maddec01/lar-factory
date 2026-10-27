// What an agent Clash may edit, and whether its edit fits the default branch. The agent reads only instruction files,
// so a Clash in any other file, which a prompt in the repository could ask for, never reaches the PR; and an edit fits
// only where its removed lines are at its line and no other edit in the file touches them.

import { posix } from 'node:path';
import { isRecord, type Clash, type ClashEdit } from '@lar-factory/shared';

/** The file names each agent loads as instructions in any folder, from #351's findings. */
const IN_ANY_FOLDER = new Set(['AGENTS.md', 'AGENTS.override.md', 'Agents.md', 'AGENT.md', 'CLAUDE.md', 'CLAUDE.local.md', 'GEMINI.md']);
/** The instruction files that sit at one path. */
const AT_PATH = new Set(['.pi/SYSTEM.md', '.pi/APPEND_SYSTEM.md', 'opencode.json']);
/** The folders whose every file is an instruction file. */
const RULE_FOLDERS = ['.claude/rules/', '.cursor/rules/', '.agents/rules/'];

/** The paths and globs `opencode.json`'s `instructions` key names, each from the repository's root; none when it has none. */
export function opencodeInstructions(json: string | undefined): string[] {
  if (json === undefined) return [];
  let config: unknown;
  try { config = JSON.parse(json); }
  catch { return []; }
  if (!isRecord(config) || !Array.isArray(config.instructions)) return [];
  return config.instructions.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.replace(/^\.\//, ''));
}

/**
 * Whether `path` is a file the Clash agent was told to read: an instruction file by its name or folder, or one that
 * `opencode.json` names in `named`. `named` comes from the repository, so a prompt in it could name any file, such as
 * `"**"`; a file it names counts only when it is Markdown outside `.github/`.
 */
export function isInstructionFile(path: string, named: readonly string[] = []): boolean {
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  return IN_ANY_FOLDER.has(parts.at(-1)!) || AT_PATH.has(path) || RULE_FOLDERS.some((folder) => path.startsWith(folder))
    || path.endsWith('.md') && parts[0] !== '.github' && named.some((entry) => entry === path || posix.matchesGlob(path, entry));
}

type LineEdit = Clash & { line: number; edit: Extract<ClashEdit, { kind: 'lines' }> };

/** Whether the Clash's edit swaps lines at a line. */
export const isLineEdit = (clash: Clash): clash is LineEdit => clash.edit.kind === 'lines' && clash.line !== undefined;

/** Whether `content`, a file's text, has the edit's removed lines from its line on. */
export function removesWhatIsThere(content: string, clash: LineEdit): boolean {
  const lines = content.split('\n');
  const at = clash.line - 1;
  return at >= 0 && at + clash.edit.remove.length <= lines.length && clash.edit.remove.every((line, i) => lines[at + i] === line);
}

/**
 * Whether two edits of one file touch the same lines: their removed lines overlap, or one only inserts at the other's
 * line or inside its removed lines, so which goes first would change the file.
 */
export function overlaps(a: LineEdit, b: LineEdit): boolean {
  if (a.file !== b.file) return false;
  const [aEnd, bEnd] = [a.line + a.edit.remove.length, b.line + b.edit.remove.length];
  if (!a.edit.remove.length || !b.edit.remove.length) {
    const [insert, other, otherEnd] = a.edit.remove.length ? [b, a, aEnd] : [a, b, bEnd];
    return insert.line === other.line || insert.line > other.line && insert.line < otherEnd;
  }
  return a.line < bEnd && b.line < aEnd;
}
