// The factory's optional agent setup, which an onboarding PR writes when the user keeps it: the `## Agent skills` block
// and the three docs/agents/ files it points at. They tell an agent how the repository's tickets relate to its work
// records, and replace Matt Pocock's setup wherever it is. They live here as text, so the bundled server ships them.

import type { Provider } from '@lar-factory/shared';

/** A file the onboarding PR writes whole. */
export interface FileWrite {
  path: string;
  content: string;
}

export const AGENT_SKILLS_BLOCK = `## Agent skills

Use \`lar-shape\` for shaping and decisions, and \`lar-build\` for builds.

### Issue tracker
GitHub issues in this repository, read by Lar Factory and picked into work records. See \`docs/agents/issue-tracker.md\`.

### Triage labels
No factory labels; an item's kind and Status live in its work record. See \`docs/agents/triage-labels.md\`.

### Domain docs
A glossary and ADRs, single-context or multi-context. See \`docs/agents/domain.md\`.
`;

function issueTracker(provider: Provider): string {
  const azure = provider === 'Azure DevOps';
  const ticket = azure ? 'work item' : 'issue';
  return `# Issue tracker: ${provider}

${azure
    ? `This repository's tickets are Azure Boards work items in its project. Lar Factory reads them with the local
\`az\` login and the azure-devops extension, per \`lar-shape/shared/issue-tracker/azure-devops.md\`.`
    : `This repository's tickets are its GitHub issues. Lar Factory reads them with the \`gh\` CLI and the local
login, which infers the repository from \`git remote -v\` inside a clone.`}
The factory's own progress lives in work records on the user's machine, so no step writes it to a ${ticket}.

## Reading ${ticket}s

${azure
    ? `Read a work item with \`az boards work-item show --id <id> --expand all --organization <org>\`, and its comments
as \`lar-shape/shared/issue-tracker/azure-devops.md\` shows.`
    : `- Read an issue: \`gh issue view <number> --comments\`.
- List open issues: \`gh issue list --state open --json number,title,labels\`.`}

## Work records

Work reaches the board when the user captures it there or picks a ${ticket} there.
Each piece of work has one record, named by its work ID, which holds its Status,
structure, brief, map, decisions, slices and PR. A picked ${ticket}'s text at pick
time is the record's initial context. Refinement in the record is the
authority, and later ${ticket} edits never change it.

Resolve a thread's argument, a work ID or a ${ticket}, with the lar skill's
\`shared/scripts/work.sh <ref>\`. For a ${ticket} no record holds, it says to pick
it on the board first. The lar skill's \`shared/issue-tracker/work-records.md\`
covers picking, Status, structure and completion.

A build delivers one standalone PR and needs no ${ticket}. Its recorded PR merging
makes it Done.

## When a skill says "publish to the issue tracker"

Publishing work as ${ticket}s arrives in a later Lar Factory release. Keep the work
in its record and tell the user publishing isn't available yet.

## When a skill says "fetch the relevant ticket"

Resolve the work with \`shared/scripts/work.sh <ref>\`, then read the record's initial context as
\`shared/issue-tracker/work-records.md\` shows. For a picked ${ticket}, the read above shows its current text.
`;
}

function triageLabels(provider: Provider): string {
  const azure = provider === 'Azure DevOps';
  const label = azure ? 'tag' : 'label';
  return `# Triage labels

Lar Factory keeps an item's kind and Status in its work record (see
\`docs/agents/issue-tracker.md\`). The repository needs no factory ${label}s, and
the factory adds none to its ${azure ? 'work items' : 'issues'}. A kind is one of \`bug\`, \`feature\`,
\`improvement\` or \`concept\`. Optional Repository config (\`.lar-factory.json\`)
lists the repository's custom \`labels\`, which mark the part of the product an
item touches.

## Matt Pocock's triage roles

Bundled guidance in \`lar-shape\` and \`lar-build\` names triage roles. Each maps
to this:

| Role | In Lar Factory |
| --- | --- |
| \`needs-triage\` | Status List |
| \`needs-info\` | Status Needs you, asking the user for what is missing |
| \`ready-for-agent\` | Unused: threads start from the board, so the item keeps its Status |
| \`ready-for-human\` | Status Needs you |
| \`wontfix\` | Abandon the work on the board, which keeps its record; closing the ${azure ? 'work item' : 'issue'} waits for the user's OK |
| \`bug\` | Kind \`bug\` |
| \`enhancement\` | Kind \`feature\` for new behaviour, or \`improvement\` for better existing behaviour |

Where a skill says to apply a role, record what it maps to. Status moves only
through the lar skill's \`shared/scripts/status.sh\`.
`;
}

const DOMAIN = `# Domain docs

How to read this repository's domain docs: its glossary and its ADRs.

## Layout

Look at the repository root:

- Single-context: one \`GLOSSARY.md\` at the root, and ADRs in \`docs/adr/\`.
- Multi-context: a root \`GLOSSARY-MAP.md\` lists each context and the path of
  its own \`GLOSSARY.md\`. Each context keeps its ADRs in a \`docs/adr/\` beside its
  glossary, and the root \`docs/adr/\` holds decisions that span contexts.

A root \`CONTEXT.md\` or \`CONTEXT-MAP.md\` is the glossary or map under its old
name. When none of these exist, proceed silently.

## Where new terms and decisions go

The lar skill's \`shared/scripts/repo-config.sh <repository>\` prints the
repository's \`domainDocs\`. With \`"kind": "repository"\`, \`lar-shape\` drafts new
terms and decisions in the work record and \`lar-build\` writes them to the named
glossary and ADR folder in the build PR. With \`"kind": "private"\`, the drafts
stay in the work record and the build PR writes no domain docs.

## Before shaping or building

Read the glossary, or in a multi-context repository the glossary of each context
the work touches, and the ADRs for the area you change.

## Use the glossary's terms

Write the glossary's terms in work titles, briefs, test names and code, and
reach past each term's _Avoid_ list to the term itself. A concept the glossary
lacks is a sign the work coins a term: record it in the brief for \`lar-build\`.

## Flag ADR conflicts

When the work contradicts an ADR, say so and name the ADR, then ask before going
against it.
`;

function docs(provider: Provider): FileWrite[] {
  return [
    { path: 'docs/agents/issue-tracker.md', content: issueTracker(provider) },
    { path: 'docs/agents/triage-labels.md', content: triageLabels(provider) },
    { path: 'docs/agents/domain.md', content: DOMAIN },
  ];
}

/** The docs/agents/ files the setup writes, which Reset deletes. */
export const AGENT_DOC_PATHS = docs('GitHub').map(({ path }) => path);

/**
 * `markdown`'s lines split around its `## Agent skills` section, which runs up to the next heading of level one or two
 * outside a code fence; null when it has no such section.
 */
function splitAtBlock(markdown: string): { before: string[]; after: string[] | null } | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^## Agent skills\s*$/.test(line));
  if (start < 0) return null;
  let fenced = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fenced = !fenced;
    else if (!fenced && /^#{1,2} /.test(lines[i]!)) { end = i; break; }
  }
  return { before: lines.slice(0, start), after: end < lines.length ? lines.slice(end) : null };
}

/** `markdown` with its `## Agent skills` section replaced by the factory's block; or null when it has no such section. */
function replaceBlock(markdown: string, block: string): string | null {
  const split = splitAtBlock(markdown);
  if (!split) return null;
  const before = split.before.join('\n');
  return `${before ? `${before}\n` : ''}${block}${split.after ? `\n${split.after.join('\n')}` : ''}`;
}

/** `markdown` without its `## Agent skills` section, every other byte as it was; or null when it has no such section. */
export function withoutAgentSkills(markdown: string): string | null {
  const split = splitAtBlock(markdown);
  return split && [...split.before, ...split.after ?? ['']].join('\n');
}

/**
 * The writes the factory's agent setup makes to a repository whose default branch has `files`, by path (only
 * `CLAUDE.md` and `AGENTS.md` matter). Each of them with an `## Agent skills` block gets it replaced where it is. With
 * none, the block goes at the end of `CLAUDE.md` if the repository has one, else of `AGENTS.md`, created when missing.
 * The three docs/agents/ files follow, whole.
 */
export function agentSetupWrites(files: Readonly<Record<string, string>>, provider: Provider): FileWrite[] {
  const block = provider === 'Azure DevOps'
    ? AGENT_SKILLS_BLOCK.replace('GitHub issues in this repository', 'Azure Boards work items for this repository')
      .replace('No factory labels', 'No factory tags')
    : AGENT_SKILLS_BLOCK;
  const replaced = ['CLAUDE.md', 'AGENTS.md'].flatMap((path) => {
    const content = files[path] === undefined ? null : replaceBlock(files[path], block);
    return content === null ? [] : [{ path, content }];
  });
  if (replaced.length) return [...replaced, ...docs(provider)];
  const path = files['CLAUDE.md'] === undefined ? 'AGENTS.md' : 'CLAUDE.md';
  const existing = (files[path] ?? '').trimEnd();
  return [{ path, content: existing ? `${existing}\n\n${block}` : block }, ...docs(provider)];
}
