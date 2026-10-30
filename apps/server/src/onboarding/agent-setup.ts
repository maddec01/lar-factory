// The factory's agent setup, which every onboarding PR writes: the `## Agent skills` block and the three docs/agents/
// files it points at. The lar-shape and lar-build skills read them to find the tracker and labels, so they
// replace Matt Pocock's setup wherever it is. They live here as text, so the bundled server ships them.

import type { Provider } from '@lar-factory/shared';

/** A file the onboarding PR writes whole. */
export interface FileWrite {
  path: string;
  content: string;
}

export const AGENT_SKILLS_BLOCK = `## Agent skills

Use \`lar-shape\` for shaping and decisions, and \`lar-build\` for builds.

### Issue tracker
GitHub issues in this repository, moved through Lar Factory's board. See \`docs/agents/issue-tracker.md\`.

### Triage labels
Lar Factory's workflow labels, with an item's state kept in its board Status. See \`docs/agents/triage-labels.md\`.

### Domain docs
A glossary and ADRs, single-context or multi-context. See \`docs/agents/domain.md\`.
`;

const ISSUE_TRACKER = `# Issue tracker: GitHub

Issues and PRs for this repository live in its GitHub issues, and Lar Factory's
board moves them through their Status. Use the \`gh\` CLI with the local login;
it infers the repository from \`git remote -v\` when run inside a clone.

## Conventions

- Create an issue: \`gh issue create --title "..." --body-file <file> --label <kind>\`,
  where the kind is \`bug\`, \`feature\` or \`improvement\` (see \`docs/agents/triage-labels.md\`).
- Read an issue: \`gh issue view <number> --comments\`.
- List issues: \`gh issue list --state open --json number,title,labels\`.
- Comment: \`gh issue comment <number> --body-file <file>\`.
- Add or remove a label: \`gh issue edit <number> --add-label <label>\` or \`--remove-label <label>\`.
- Close: \`gh issue close <number> --reason completed\`, or \`--reason "not planned"\`.
- Make a sub-issue: \`gh issue create --parent <number> ...\`, or
  \`gh issue edit <parent> --add-sub-issue <child>\` for an existing issue.
- Mark a blocker: \`gh issue edit <child> --add-blocked-by <blocker>\`.

Sub-issues and blocked-by are GitHub's native relationships. A \`Part of #n\`
mention creates neither.

## Status

Each item has one Status: List, Queued, Shaping, Needs you, Ready, In progress,
Review, Verify, Ready to merge or Done. It lives as one
\`status-<name>\` label on the issue, such as \`status-needs-you\`. Move an item
with the \`lar-shape\` skill's \`scripts/status.sh <issue-url> "<Status>"\`. Closing
an issue makes it Done. State lives in Status alone, so assignees and other
labels stay free of it.

## Concepts

Work too broad or unclear for one issue is a \`concept\` issue: a map whose
native sub-issues are decisions (\`decision-grill\`, \`decision-prototype\`,
\`decision-research\`, \`decision-task\`) and builds (\`build\`). A build becomes
one PR, and its slices are its sub-issues. Read \`lar-shape\` before shaping and \`lar-build\` before slicing or building.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in this repository with \`gh issue create\`.

## When a skill says "fetch the relevant ticket"

Run \`gh issue view <number> --comments\`.
`;

const AZURE_ISSUE_TRACKER = `# Issue tracker: Azure DevOps

Track work in Azure Boards work items.
Lar Factory's board moves them through their Status.
Use the local \`az\` login with the azure-devops extension.
Read \`lar-shape/issue-tracker/azure-devops.md\`'s Azure DevOps section before changing work items.

## Repository and project

Take the organization, project and repository from the git origin.
Decode the project name, including spaces.
A work item URL ends in \`/_workitems/edit/<id>\`.
The lar-shape scripts accept the repository's origin URL or \`<org>/<project>/<repo>\`.

\`\`\`sh
org=https://dev.azure.com/<org>
project="<project>"
azure_repo=<org>/<project>/<repo>
\`\`\`

Pass \`--organization "$org"\` to every Azure command.

## Read and create work items

Read a work item:

\`\`\`sh
az boards work-item show --id "$id" --expand all --organization "$org"
\`\`\`

Create a top-level work item with the team's requirement type.
Use User Story, Product Backlog Item, Issue or Requirement as the process names it.

\`\`\`sh
id=$(az boards work-item create --type "<requirement type>" --title "<title>" \\
  --project "$project" --organization "$org" --query id -o tsv)
\`\`\`

Tag it \`repo-<repo>\` and its kind.
Use lar-shape's Azure instructions to write Markdown descriptions and comments.

## Tags and relationships

Kinds and workflow labels are tags in \`System.Tags\`.
Read all tags before updating them because each write replaces the whole string.
See \`docs/agents/triage-labels.md\`.
Find work items with a tag:

\`\`\`sh
az boards query --organization "$org" --project "$project" \\
  --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS 'active'"
\`\`\`

Create a child Task with lar-shape's \`scripts/slice.sh\`:

\`\`\`sh
child_url=$(bash <lar-shape>/scripts/slice.sh "$azure_repo" "$parent_url" "<title>" /path/to/brief.md)
\`\`\`

Attach an existing child or mark its blocker:

\`\`\`sh
az boards work-item relation add --id "$child" --relation-type parent --target-id "$parent" --organization "$org"
az boards work-item relation add --id "$child" --relation-type predecessor --target-id "$blocker" --organization "$org"
\`\`\`

Verify links with a read before retrying a write.

## Status and concepts

Move an item with lar-shape's \`scripts/status.sh <work-item-url> "<Status>"\`.
It keeps one \`status-<name>\` tag, such as \`status-needs-you\`.
It moves Azure State when the Status category changes.
A Completed-category State makes an item Done.
Close work that will not proceed in its type's Removed-category State.
Read lar-shape's Azure instructions to find the process's State names.

Tag broad work \`concept\`.
Its decisions and builds are child Tasks with \`decision-*\` or \`build\` tags.
A build becomes one PR in Azure Repos.
Its slices are child Tasks.
Tasks with \`build\`, \`decision-*\`, \`concept\` or a valid \`status-*\` tag appear on the board.
Slices carry only slice tags (\`active\` or \`blocked\`), with no factory Status.
Plain team Tasks stay off the board and contribute only to parent counts.

## When a skill says "publish to the issue tracker"

Create an Azure Boards work item with the command above.

## When a skill says "fetch the relevant ticket"

Read the work item with the command above.
`;

function triageLabels(provider: Provider): string {
  const azure = provider === 'Azure DevOps';
  return `# Triage labels

Lar Factory keeps an item's state in its Status (see \`docs/agents/issue-tracker.md\`),
so a ${azure ? 'tag' : 'label'} says what an item is.
${azure ? 'Azure DevOps stores workflow labels as tags in `System.Tags`.\nTags need no setup.' : 'Every repository has these workflow labels:'}

| ${azure ? 'Tag' : 'Label'} | Meaning |
| --- | --- |
| \`bug\` | Something broken |
| \`feature\` | New behaviour |
| \`improvement\` | Better existing behaviour |
| \`concept\` | A map of work needing decisions and builds |
| \`decision-grill\` | Concept decision settled by questions |
| \`decision-prototype\` | Concept decision settled by a prototype |
| \`decision-research\` | Concept decision settled by research |
| \`decision-task\` | Concept decision settled by a small task |
| \`build\` | ${azure ? 'Work item' : 'Issue'} that becomes one PR |
| \`active\` | Slice an implementer is working on now |
| \`blocked\` | Slice an implementer couldn't finish, waiting for a re-slice |

An item's kind is one of \`bug\`, \`feature\`, \`improvement\` or \`concept\`. The
\`labels\` in \`.lar-factory.json\` list the repository's custom ${azure ? 'tags' : 'labels'}, which mark
the part of the product an item touches.

## Matt Pocock's triage roles

Bundled guidance in \`lar-shape\` and \`lar-build\` names triage roles. Each maps to this:

| Role | In Lar Factory |
| --- | --- |
| \`needs-triage\` | Status List |
| \`needs-info\` | Status Needs you, with a comment that says what is missing |
| \`ready-for-agent\` | Unused: threads start from the board, so the item keeps its Status and gets no ${azure ? 'tag' : 'label'} |
| \`ready-for-human\` | Status Needs you |
| \`wontfix\` | ${azure ? "Close the work item in its type's Removed-category State. See lar-shape's Azure instructions." : 'Close the issue as not planned: `gh issue close <number> --reason "not planned"`'} |
| \`bug\` | \`bug\` |
| \`enhancement\` | \`feature\` or \`improvement\`: \`feature\` for new behaviour, \`improvement\` for better existing behaviour |

Where a skill says to apply a state role, set the Status it maps to.
${azure ? '\nRead all of `System.Tags` before changing tags. Each write replaces the whole string.\nUse the `retag` function in lar-shape/issue-tracker/azure-devops.md to preserve other tags.\nLet `scripts/status.sh` own the `status-*` tags.\n' : ''}`;
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
name. When none of these exist, proceed silently; \`lar-shape\` drafts them when a term or decision settles, and \`lar-build\` writes them in the build PR.

## Before shaping or building

Read the glossary, or in a multi-context repository the glossary of each context
the work touches, and the ADRs for the area you change.

## Use the glossary's terms

Write the glossary's terms in issue titles, briefs, test names and code, and
reach past each term's _Avoid_ list to the term itself. A concept the glossary
lacks is a sign the work coins a term: record it in the brief for \`lar-build\`.

## Flag ADR conflicts

When the work contradicts an ADR, say so and name the ADR, then ask before going
against it.
`;

const DOCS: FileWrite[] = [
  { path: 'docs/agents/issue-tracker.md', content: ISSUE_TRACKER },
  { path: 'docs/agents/triage-labels.md', content: triageLabels('GitHub') },
  { path: 'docs/agents/domain.md', content: DOMAIN },
];

/** The docs/agents/ files the setup writes, which Reset deletes. */
export const AGENT_DOC_PATHS = DOCS.map(({ path }) => path);

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
      .replace("Lar Factory's workflow labels", "Lar Factory's workflow tags")
    : AGENT_SKILLS_BLOCK;
  const docs = provider === 'Azure DevOps' ? [
    { path: 'docs/agents/issue-tracker.md', content: AZURE_ISSUE_TRACKER },
    { path: 'docs/agents/triage-labels.md', content: triageLabels(provider) },
    { path: 'docs/agents/domain.md', content: DOMAIN },
  ] : DOCS;
  const replaced = ['CLAUDE.md', 'AGENTS.md'].flatMap((path) => {
    const content = files[path] === undefined ? null : replaceBlock(files[path], block);
    return content === null ? [] : [{ path, content }];
  });
  if (replaced.length) return [...replaced, ...docs];
  const path = files['CLAUDE.md'] === undefined ? 'AGENTS.md' : 'CLAUDE.md';
  const existing = (files[path] ?? '').trimEnd();
  return [{ path, content: existing ? `${existing}\n\n${block}` : block }, ...docs];
}
