// What onboarding's PR changes against the default branch's head, worked out before anything is written: the tree
// entries of its one commit, and the list the Pull request step and the PR body show. Each ticked edit swaps its lines
// at the line the Clash names on that head, so an edit whose lines moved fails rather than landing in the wrong place.

import { posix } from 'node:path';
import { skillRenameProblem, type Provider, type OnboardingPicks, type OnboardingPrChange } from '@lar-factory/shared';
import type { CommitTree, TreeEntry } from '../github/github.ts';
import { agentSetupWrites } from './agent-setup.ts';
import { isInstructionFile, isLineEdit, opencodeInstructions, overlaps, removesWhatIsThere } from './clash-edits.ts';
import { projectSkills } from './fixed-clashes.ts';

export interface PrPlan {
  /** The default branch's tree the entries change. */
  base: string;
  entries: TreeEntry[];
  changes: OnboardingPrChange[];
}

/** `skill` with its front matter's `name:` set to `name`, in `\n` or `\r\n` lines; as it is when its front matter has none. */
function renameSkill(skill: string, name: string): string {
  const front = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(skill)?.[0];
  return front ? skill.replace(front, front.replace(/^name:.*$/m, `name: ${name}`)) : skill;
}

/** The folder that holds a skill's folder, such as `.claude/skills/`. */
const skillsDir = (path: string) => path.replace(/[^/]+\/$/, '');

/** A symbolic link's mode in a Git tree. */
const LINK = '120000';

/**
 * The file `path` stands for on the branch: itself when it is no symbolic link or is missing, else the file its link
 * leads to, resolved from the link's folder. Null when the link leads out of the repository, to a missing file or round
 * in a loop.
 */
export async function linkTarget(tree: CommitTree, read: (sha: string) => Promise<string>, path: string): Promise<string | null> {
  let at = path;
  for (let hops = 0; hops < 8; hops++) {
    const entry = tree.files.get(at);
    if (!entry) return at === path ? path : null;
    if (entry.mode !== LINK) return at;
    const target = posix.normalize(posix.join(posix.dirname(at), (await read(entry.sha)).trim()));
    if (target.startsWith('../') || target === '..' || posix.isAbsolute(target)) return null;
    at = target;
  }
  return null;
}

/**
 * The PR's changes to the default branch's `tree`, whose blobs `read` gives: ticked line edits, the factory's agent
 * setup, `config` as .lar-factory.json unless it is null because the repository's own is reused, then each delete and
 * rename, with a renamed skill's SKILL.md naming it anew. Returns the problem when a pick no longer fits the branch, or
 * is one the Cleanup step can't make: an edit of a file the Clash agent doesn't read, or a skill pick for a folder that
 * is no project skill named like one of the `bundled` skills, or a rename to a name the Cleanup step refuses.
 */
export async function planPrChanges(tree: CommitTree, read: (sha: string) => Promise<string>, config: string | null,
  picks: OnboardingPicks, bundled: readonly string[], provider: Provider): Promise<PrPlan | { problem: string }> {
  const texts = new Map<string, string>();
  /** Each renamed file's path, by its new path, whose blob it keeps unless `texts` has its new text. */
  const moved = new Map<string, string>();
  const deleted = new Set<string>();
  const changes: OnboardingPrChange[] = [];
  const text = async (path: string) => {
    const blob = tree.files.get(path);
    return texts.get(path) ?? (blob ? await read(blob.sha) : undefined);
  };

  const edits = picks.clashes.filter(isLineEdit);
  const named = opencodeInstructions(await text('opencode.json'));
  const fix = 'Uncheck this change in Cleanup or check instructions again.';
  for (const clash of edits) {
    if (!isInstructionFile(clash.file, named)) return { problem: `${clash.file} is not an agent instruction file. The pull request cannot edit it.` };
    if (edits.some((other) => other !== clash && overlaps(clash, other))) {
      return { problem: `Two changes overlap at line ${clash.line} in ${clash.file}. ${fix}` };
    }
  }
  // Bottom up, so an edit never shifts the lines another in its file names.
  for (const clash of [...edits].sort((a, b) => b.line - a.line)) {
    const content = await text(clash.file);
    if (content === undefined) return { problem: `${clash.file} no longer exists on the default branch. ${fix}` };
    if (tree.files.get(clash.file)?.mode === LINK) return { problem: `${clash.file} links to another file. Edit that file instead. ${fix}` };
    if (!removesWhatIsThere(content, clash)) return { problem: `The text at line ${clash.line} in ${clash.file} has changed. ${fix}` };
    const lines = content.split('\n');
    lines.splice(clash.line - 1, clash.edit.remove.length, ...clash.edit.add);
    texts.set(clash.file, lines.join('\n'));
  }

  const instructions: Record<string, string> = {};
  /** CLAUDE.md or AGENTS.md by its own path, or by the file it links to, which the block goes in. */
  const real: Record<string, string> = {};
  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    const resolved = await linkTarget(tree, read, path);
    if (resolved === null) return { problem: `${path} links to a missing file. Fix the link on the default branch before continuing.` };
    // A link can lead anywhere in the repository, such as a workflow, which the block must not go in. It may lead to an
    // instruction file, or to any Markdown file outside `.github/`, such as `docs/ai-guidelines.md`: `'**'` names every
    // file, and isInstructionFile takes a named file only when it is Markdown outside `.github/`.
    if (!isInstructionFile(resolved, ['**'])) {
      return { problem: `${path} links to ${resolved}, which is not an agent instruction file. Point it to an instruction file on the default branch before continuing.` };
    }
    real[path] = resolved;
    const content = await text(resolved);
    if (content !== undefined) instructions[path] = content;
  }
  const written = new Set<string>();
  for (const write of agentSetupWrites(instructions, provider)) {
    const path = real[write.path] ?? write.path;
    // CLAUDE.md linked to AGENTS.md gets the same block as AGENTS.md, so it is written once.
    if (written.has(path)) continue;
    written.add(path);
    texts.set(path, write.content);
    changes.push(path.startsWith('docs/agents/') ? { kind: 'write', path, created: !tree.files.has(path) } : { kind: 'agent-skills', path });
  }
  if (config !== null) {
    texts.set('.lar-factory.json', config);
    changes.push({ kind: 'write', path: '.lar-factory.json', created: !tree.files.has('.lar-factory.json') });
  }
  for (const clash of edits) changes.push({ kind: 'edit', path: clash.file, line: clash.line, reason: clash.reason });

  const skills = projectSkills([...tree.files.keys()]);
  for (const [path, pick] of Object.entries(picks.skills)) {
    const skill = skills.find((s) => s.path === path);
    if (!skill || !bundled.some((name) => name.toLowerCase() === skill.name.toLowerCase())) {
      return { problem: `${path} no longer needs renaming or removal. Go back to Cleanup to check again.` };
    }
    const renamedBeside = Object.entries(picks.skills).flatMap(([other, picked]) =>
      other !== path && skillsDir(other) === skillsDir(path) && picked.kind === 'rename' ? [picked.name] : []);
    const problem = pick.kind === 'rename'
      && skillRenameProblem(pick.name, bundled, skills.filter((s) => s.name !== skill.name).map((s) => s.name), renamedBeside);
    if (problem) return { problem: `Can't rename ${path}: ${problem}` };
  }

  /** The branch's files at `path`, a file or a folder ending in `/`. */
  const at = (path: string) => path.endsWith('/') ? [...tree.files.keys()].filter((file) => file.startsWith(path)) : tree.files.has(path) ? [path] : [];
  const fixes = [
    ...picks.clashes.flatMap((clash) => clash.edit.kind === 'lines' ? [] : [{ path: clash.file, to: clash.edit.kind === 'rename' ? clash.edit.to : null }]),
    ...Object.entries(picks.skills).map(([path, skill]) => ({ path, to: skill.kind === 'rename' ? `${skillsDir(path)}${skill.name}/` : null })),
  ];
  for (const { path, to } of fixes) {
    const files = at(path);
    if (!files.length) return { problem: `${path} is not on the default branch any more.` };
    for (const file of files) {
      deleted.add(file);
      const content = texts.get(file);
      texts.delete(file);
      if (to === null) continue;
      const target = path.endsWith('/') ? `${to}${file.slice(path.length)}` : to;
      if (tree.files.has(target) || texts.has(target)) return { problem: `Cannot rename ${path} to ${to}. ${target} already exists on the default branch.` };
      moved.set(target, file);
      if (content !== undefined) texts.set(target, content);
    }
    if (to !== null && path in picks.skills) {
      const skillFile = `${to}SKILL.md`;
      const skill = texts.get(skillFile) ?? await read(tree.files.get(`${path}SKILL.md`)!.sha);
      texts.set(skillFile, renameSkill(skill, to.slice(0, -1).split('/').at(-1)!));
    }
    changes.push(to === null ? { kind: 'delete', path } : { kind: 'rename', path, to });
  }

  const mode = (path: string) => tree.files.get(moved.get(path) ?? path)?.mode ?? '100644';
  return {
    base: tree.sha,
    entries: [
      ...[...deleted].filter((path) => !texts.has(path) && !moved.has(path)).map((path) => ({ path, mode: mode(path), sha: null })),
      ...[...moved].filter(([path]) => !texts.has(path)).map(([path, from]) => ({ path, mode: mode(path), sha: tree.files.get(from)!.sha })),
      ...[...texts].map(([path, content]) => ({ path, mode: mode(path), content })),
    ],
    changes,
  };
}
