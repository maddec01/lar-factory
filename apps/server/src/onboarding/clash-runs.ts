// Onboarding's Clash agent: a T3 thread in the repository's T3 project that reads every instruction file on a fresh
// fetch of the default branch and answers with the rules that work against the factory's. The board keeps each
// repository's last five runs in memory, so closing the dialog leaves a run going, and Retry adds a run beside the old one.

import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isRecord, onAzure, type Clash, type ClashRun, type ClashRunState, type ModelChoice, type ModelGroup } from '@lar-factory/shared';
import { AZURE_REPOS } from '../azure/azure-repos.ts';
import { isRepo } from '../config/repository-config.ts';
import { defaultBranchHead, message as errorMessage } from '../github/github.ts';
import { liveProjects, threadByTitle } from '../t3/t3-db.ts';
import { statsDbPath } from '../t3/t3-settings.ts';
import { startThreadAndWait, type WaitedRun } from '../t3/t3.ts';
import { findModelChoice } from '../t3/model-choices.ts';
import { isInstructionFile, isLineEdit, opencodeInstructions, overlaps, removesWhatIsThere } from './clash-edits.ts';
import { runTool } from '../tools/run-tool.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';

/** The repository's default branch, read with az on Azure DevOps and gh on GitHub; `run` stands in for that tool. */
export async function defaultBranch(repo: string, run?: (args: string[]) => Promise<string>): Promise<string> {
  return (await (onAzure(repo) ? AZURE_REPOS.defaultBranchHead : defaultBranchHead)(repo, run)).branch;
}

/** What a run reads and runs: gh or az, T3's projects and threads, git and t3. */
export interface ClashRunDeps {
  defaultBranch(repo: string): Promise<string>;
  /** The T3 project's folder, or null when T3 no longer has it; throws when T3's projects can't be read. */
  projectFolder(projectId: string): string | null;
  /** Runs `git fetch origin <branch>` in the folder, returning null once it fetched, else the problem. */
  fetch(folder: string, branch: string): Promise<string | null>;
  /** The file at `path` on `ref` in the folder, as `git show <ref>:<path>` prints it; null when it can't. */
  show(folder: string, ref: string, path: string): Promise<string | null>;
  /** Whether `path` on `ref` in the folder is a symbolic link, whose `show` prints only where it leads. */
  isLink(folder: string, ref: string, path: string): Promise<boolean>;
  start(projectId: string, message: string, choice: ModelChoice, title: string): Promise<WaitedRun>;
  /** The project's thread with this title and its latest assistant message; throws when T3's database can't be read. */
  thread(projectId: string, title: string): { threadId: string; latest: string | null } | null;
  runId(): string;
  now(): Date;
}

const DEPS: ClashRunDeps = {
  defaultBranch: (repo) => defaultBranch(repo),
  projectFolder: (projectId) => liveProjects(statsDbPath(), homedir()).find((p) => p.id === projectId)?.folder ?? null,
  fetch: async (folder, branch) => {
    const git = toolCommand('git');
    if (!git) return missingTool('git');
    const { code, detail } = await runTool(git.file, ['-C', folder, 'fetch', 'origin', branch], { env: git.env, timeout: 120_000 });
    return code === 0 ? null : detail || 'git fetch did not finish in time.';
  },
  show: async (folder, ref, path) => {
    const git = toolCommand('git');
    if (!git) return null;
    const { code, stdout } = await runTool(git.file, ['-C', folder, 'show', `${ref}:${path}`], { env: git.env, timeout: 30_000 });
    return code === 0 ? stdout : null;
  },
  isLink: async (folder, ref, path) => {
    const git = toolCommand('git');
    if (!git) return false;
    const { code, stdout } = await runTool(git.file, ['-C', folder, 'ls-tree', '--full-tree', ref, '--', path], { env: git.env, timeout: 30_000 });
    return code === 0 && stdout.startsWith('120000 ');
  },
  start: (projectId, message, choice, title) => startThreadAndWait(projectId, message, choice, title),
  thread: (projectId, title) => threadByTitle(statsDbPath(), projectId, title),
  runId: () => randomUUID().slice(0, 8),
  now: () => new Date(),
};

/** The instruction files each agent loads, from #351's findings ("Where each agent loads skills and instructions"). */
const INSTRUCTION_FILES = `- \`AGENTS.md\`, \`AGENTS.override.md\`, \`Agents.md\`, \`AGENT.md\`, \`CLAUDE.md\`, \`CLAUDE.local.md\` and \`GEMINI.md\`, in any folder
- \`.claude/CLAUDE.md\` and every file in \`.claude/rules/\`
- every file in \`.cursor/rules/\`
- \`.agents/AGENTS.md\`, \`.agents/GEMINI.md\` and every file in \`.agents/rules/\`
- \`.pi/SYSTEM.md\` and \`.pi/APPEND_SYSTEM.md\`
- \`opencode.json\`'s \`instructions\` key and each file it names`;

/** The message that starts a run on the repository's freshly fetched default branch. */
function clashMessage(repo: string, branch: string): string {
  const ref = `origin/${branch}`;
  return `Look for Clashes in ${repo}

Lar Factory, a set of agent skills and a board, is about to take over the work in ${repo}. Find each rule in the repository's agent instruction files that would make an agent work against the factory. That is a Clash.

The factory works like this:
- Agents push branches and open PRs, and the user merges every PR. A rule to push or merge to ${branch} directly clashes.
- Work is tracked in the repository's GitHub issues or Azure Boards work items, as \`docs/agents/issue-tracker.md\` describes. A rule to track work anywhere else, such as Linear, Jira or a local \`.scratch/\` folder, clashes.
- A change passes its checks before review. A rule to skip tests or checks clashes.
- Agents follow the factory's installed skills. A rule to ignore them, or to run \`/setup-matt-pocock-skills\`, clashes.

Read the files as they are on ${ref}, which the board has just fetched, not the working tree, so your line numbers match ${ref}:
1. List the files with \`git ls-tree -r --name-only ${ref}\`.
2. Read each instruction file with \`git show ${ref}:<path>\`. The instruction files are:
${INSTRUCTION_FILES}
3. Skip the \`## Agent skills\` section and the files in \`docs/agents/\`, which onboarding rewrites anyway.

Change nothing: don't edit, commit or push.

Answer with only this JSON, and \`{ "clashes": [] }\` when you find none:
{ "clashes": [{ "file": "<path>", "line": <the first removed line's number in ${ref}, from 1>, "reason": "<how the rule works against the factory, in one or two sentences>", "remove": ["<each line to remove, exactly as in the file>"], "add": ["<each line to put in their place, or none>"] }] }`;
}

const isLines = (value: unknown): value is string[] => Array.isArray(value) && value.every((line) => typeof line === 'string');

/**
 * The agent's Clashes, each a ticked edit of its lines, or null when the reply isn't the JSON the message asked for. A
 * Clash in a file that `isInstruction` says the agent wasn't told to read is dropped, so no other file reaches the PR.
 */
export function parseClashReply(reply: string, isInstruction: (path: string) => boolean = isInstructionFile): Clash[] | null {
  const json = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(reply)?.[1] ?? reply;
  let answer: unknown;
  try { answer = JSON.parse(json); }
  catch { return null; }
  if (!isRecord(answer) || !Array.isArray(answer.clashes)) return null;
  const clashes: Clash[] = [];
  for (const [i, found] of answer.clashes.entries()) {
    if (!isRecord(found)) return null;
    const { file, line, reason, remove, add } = found;
    if (typeof file !== 'string' || !file.trim() || !Number.isInteger(line) || (line as number) < 1 || typeof reason !== 'string' || !reason.trim()
      || !isLines(remove) || !remove.length || !isLines(add)) return null;
    if (!isInstruction(file)) continue;
    clashes.push({ id: `agent-${i + 1}`, file, line: line as number, reason: reason.trim(), edit: { kind: 'lines', remove, add }, ticked: true });
  }
  return clashes;
}

/**
 * The agent's Clashes as they fit the default branch, whose files `read` gives: a Clash in a file `isLink` says is a
 * symbolic link, whose removed lines aren't at its line, or that touches another's lines, is unticked with why its
 * edit won't apply.
 */
async function checkEdits(clashes: Clash[], read: (path: string) => Promise<string | null>, isLink: (path: string) => Promise<boolean>): Promise<Clash[]> {
  const texts = new Map<string, Promise<string | null>>();
  const text = (path: string) => texts.get(path) ?? texts.set(path, read(path)).get(path)!;
  const links = new Map<string, Promise<boolean>>();
  const linked = (path: string) => links.get(path) ?? links.set(path, isLink(path)).get(path)!;
  const edits = clashes.filter(isLineEdit);
  return Promise.all(clashes.map(async (clash) => {
    if (!isLineEdit(clash)) return clash;
    const content = await text(clash.file);
    const wontApply = content === null ? `${clash.file} no longer exists on the default branch.`
      : await linked(clash.file) ? `${clash.file} links to another file. Edit that file instead.`
      : !removesWhatIsThere(content, clash) ? `The text at line ${clash.line} in ${clash.file} has changed.`
      : edits.some((other) => other !== clash && overlaps(clash, other)) ? `Two changes overlap in ${clash.file}. Check instructions again before continuing.`
      : null;
    return wontApply ? { ...clash, ticked: false, wontApply } : clash;
  }));
}

/** The state a waited run ends in, with its Clashes checked against the default branch's files, which `read` gives. */
async function endState(ended: WaitedRun, read: (path: string) => Promise<string | null>, isLink: (path: string) => Promise<boolean>): Promise<ClashRunState> {
  switch (ended.ended) {
    case 'completed': {
      const named = opencodeInstructions(await read('opencode.json') ?? undefined);
      const clashes = parseClashReply(ended.reply, (path) => isInstructionFile(path, named));
      if (clashes) return { state: 'done', clashes: await checkEdits(clashes, read, isLink) };
      const start = ended.reply.trim().slice(0, 200);
      return { state: 'failed', why: `The agent returned an unreadable reply. Try the check again. The reply began with ${start || '(empty)'}.` };
    }
    case 'failed': return { state: 'failed', why: ended.why };
    case 'waiting': return { state: 'waiting', why: 'The agent needs an answer in T3 Code. Open its thread and respond, then retry the check.' };
    case 'timed-out': return { state: 'timed-out', why: 'The check took more than 15 minutes. Open its thread in T3 Code to see whether it is still running.' };
  }
}

/** How many of a repository's runs the board keeps, the latest last. */
const KEPT_RUNS = 5;

interface Entry {
  projectId: string;
  run: ClashRun;
}

export interface ClashRuns {
  /** Starts a run for the body's repository, T3 project and model, or returns the running one; answers every run of the repository. */
  start(input: Record<string, unknown>): Promise<{ runs: ClashRun[] } | { status: number; error: string }>;
  /** The repository's runs, oldest first, a running one with its thread and latest message as T3's database has them now. */
  list(repo: string): ClashRun[];
}

export function createClashRuns(modelGroups: () => readonly ModelGroup[], deps: ClashRunDeps = DEPS): ClashRuns {
  const runs = new Map<string, Entry[]>();

  /** Reads the run's thread from T3's database while the run doesn't know it; leaves the run as is when it can't. */
  function withThread(entry: Entry): ClashRun {
    const { run } = entry;
    if (run.threadId && run.state !== 'running') return run;
    let found;
    try { found = deps.thread(entry.projectId, run.title); }
    catch { return run; }
    if (!found) return run;
    if (run.state === 'running') return { ...run, threadId: found.threadId, progress: found.latest };
    entry.run = { ...run, threadId: found.threadId };
    return entry.run;
  }

  const list = (repo: string) => (runs.get(repo.toLowerCase()) ?? []).map(withThread);

  function end(entry: Entry, state: ClashRunState, threadId: string | null = null): void {
    const { title, model, startedAt } = entry.run;
    entry.run = { ...state, title, model, startedAt, threadId: threadId ?? entry.run.threadId };
    withThread(entry);
  }

  async function go(entry: Entry, repo: string): Promise<void> {
    const failed = (why: string) => end(entry, { state: 'failed', why });
    let branch;
    try { branch = await deps.defaultBranch(repo); }
    catch (err) { return failed(`Can't read ${repo}'s default branch: ${errorMessage(err)}`); }
    let folder;
    try { folder = deps.projectFolder(entry.projectId); }
    catch (err) { return failed(`Can't read T3 Code's projects: ${errorMessage(err)}`); }
    if (!folder) return failed('T3 Code no longer has the T3 project. Go back and pick one.');
    const problem = await deps.fetch(folder, branch);
    if (problem) return failed(`Can't fetch origin/${branch} in ${folder}: ${problem}`);
    const ended = await deps.start(entry.projectId, clashMessage(repo, branch), entry.run.model, entry.run.title);
    const ref = `origin/${branch}`;
    end(entry, await endState(ended, (path) => deps.show(folder, ref, path), (path) => deps.isLink(folder, ref, path)), ended.threadId);
  }

  return {
    async start(input) {
      const { repo, projectId } = input;
      const model = findModelChoice(modelGroups(), input.model);
      if (!isRepo(repo) || typeof projectId !== 'string' || !projectId || !model) {
        return { status: 400, error: 'Send the repository, its T3 project and a model T3 offers.' };
      }
      const key = repo.toLowerCase();
      const entries = runs.get(key) ?? [];
      runs.set(key, entries);
      if (entries.at(-1)?.run.state !== 'running') {
        const entry: Entry = { projectId, run: { state: 'running', progress: null, title: `Look for Clashes in ${key} (run ${deps.runId()})`,
          threadId: null, model, startedAt: deps.now().toISOString() } };
        entries.push(entry);
        // Older runs drop off, so a repository's runs never grow past the last few.
        entries.splice(0, entries.length - KEPT_RUNS);
        void go(entry, key).catch((err: unknown) => end(entry, { state: 'failed', why: errorMessage(err) }));
      }
      return { runs: list(key) };
    },
    list,
  };
}
