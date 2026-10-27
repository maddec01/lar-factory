// The factory's agent setup, which every onboarding PR writes: the `## Agent skills` block and the three docs/agents/
// files it points at. The bundled to-tickets and code-review Copies read them to find the tracker and labels, so they
// replace Matt Pocock's setup wherever it is. They live here as text, so the bundled server ships them.

/** A file the onboarding PR writes whole. */
export interface FileWrite {
  path: string;
  content: string;
}

export const AGENT_SKILLS_BLOCK = `## Agent skills

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
Review, Verify, Ready to merge or Done. The \`itemSource\` in \`.lar-factory.json\`
says where it lives: in a GitHub Project's Status field, or as one
\`status-<name>\` label on the issue, such as \`status-needs-you\`. Move an item
with the \`lar-work\` skill's \`scripts/status.sh <issue-url> "<Status>"\`. Closing
an issue makes it Done. State lives in Status alone, so assignees and other
labels stay free of it.

## Concepts

Work too broad or unclear for one issue is a \`concept\` issue: a map whose
native sub-issues are decisions (\`decision-grill\`, \`decision-prototype\`,
\`decision-research\`, \`decision-task\`) and builds (\`build\`). A build becomes
one PR, and its slices are its sub-issues. The \`lar-work\` skill runs this
workflow; read it before shaping, slicing or building.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in this repository with \`gh issue create\`.

## When a skill says "fetch the relevant ticket"

Run \`gh issue view <number> --comments\`.
`;

const TRIAGE_LABELS = `# Triage labels

Lar Factory keeps an item's state in its Status (see \`docs/agents/issue-tracker.md\`),
so a label says what an item is, never where it stands. Every repository has
these workflow labels:

| Label | Meaning |
| --- | --- |
| \`bug\` | Something broken |
| \`feature\` | New behaviour |
| \`improvement\` | Better existing behaviour |
| \`concept\` | A map of work needing decisions and builds |
| \`decision-grill\` | Concept decision settled by questions |
| \`decision-prototype\` | Concept decision settled by a prototype |
| \`decision-research\` | Concept decision settled by research |
| \`decision-task\` | Concept decision settled by a small task |
| \`build\` | Issue that becomes one PR |
| \`active\` | Slice an implementer is working on now |
| \`blocked\` | Slice an implementer couldn't finish, waiting for a re-slice |

An item's kind is one of \`bug\`, \`feature\`, \`improvement\` or \`concept\`. The
\`labels\` in \`.lar-factory.json\` list the repository's custom labels, which mark
the part of the product an item touches.

## Matt Pocock's triage roles

Skills such as \`triage\` and \`to-tickets\` name triage roles. Each maps to this:

| Role | In Lar Factory |
| --- | --- |
| \`needs-triage\` | Status List |
| \`needs-info\` | Status Needs you, with a comment that says what is missing |
| \`ready-for-agent\` | Unused: threads start from the board, so the item keeps its Status and gets no label |
| \`ready-for-human\` | Status Needs you |
| \`wontfix\` | Close the issue as not planned: \`gh issue close <number> --reason "not planned"\` |
| \`bug\` | \`bug\` |
| \`enhancement\` | \`feature\` or \`improvement\`: \`feature\` for new behaviour, \`improvement\` for better existing behaviour |

Where a skill says to apply a state role, set the Status it maps to.
`;

const DOMAIN = `# Domain docs

How to read this repository's domain docs: its glossary and its ADRs.

## Layout

Look at the repository root:

- Single-context: one \`GLOSSARY.md\` at the root, and ADRs in \`docs/adr/\`.
- Multi-context: a root \`GLOSSARY-MAP.md\` lists each context and the path of
  its own \`GLOSSARY.md\`. Each context keeps its ADRs in a \`docs/adr/\` beside its
  glossary, and the root \`docs/adr/\` holds decisions that span contexts.

A root \`CONTEXT.md\` or \`CONTEXT-MAP.md\` is the glossary or map under its old
name. When none of these exist, proceed silently; the \`domain-modeling\` skill
creates them when a term or decision settles.

## Before shaping or building

Read the glossary, or in a multi-context repository the glossary of each context
the work touches, and the ADRs for the area you change.

## Use the glossary's terms

Write the glossary's terms in issue titles, briefs, test names and code, and
reach past each term's _Avoid_ list to the term itself. A concept the glossary
lacks is a sign the work coins a term: note it for \`domain-modeling\`.

## Flag ADR conflicts

When the work contradicts an ADR, say so and name the ADR, then ask before going
against it.
`;

const DOCS: FileWrite[] = [
  { path: 'docs/agents/issue-tracker.md', content: ISSUE_TRACKER },
  { path: 'docs/agents/triage-labels.md', content: TRIAGE_LABELS },
  { path: 'docs/agents/domain.md', content: DOMAIN },
];

/**
 * `markdown` with its `## Agent skills` section, up to the next heading of level one or two outside a code fence,
 * replaced by the factory's block; or null when it has no such section.
 */
function replaceBlock(markdown: string): string | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^## Agent skills\s*$/.test(line));
  if (start < 0) return null;
  let fenced = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fenced = !fenced;
    else if (!fenced && /^#{1,2} /.test(lines[i]!)) { end = i; break; }
  }
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(end).join('\n');
  return `${before ? `${before}\n` : ''}${AGENT_SKILLS_BLOCK}${end < lines.length ? `\n${after}` : ''}`;
}

/**
 * The writes the factory's agent setup makes to a repository whose default branch has `files`, by path (only
 * `CLAUDE.md` and `AGENTS.md` matter). Each of them with an `## Agent skills` block gets it replaced where it is. With
 * none, the block goes at the end of `CLAUDE.md` if the repository has one, else of `AGENTS.md`, created when missing.
 * The three docs/agents/ files follow, whole.
 */
export function agentSetupWrites(files: Readonly<Record<string, string>>): FileWrite[] {
  const replaced = ['CLAUDE.md', 'AGENTS.md'].flatMap((path) => {
    const content = files[path] === undefined ? null : replaceBlock(files[path]);
    return content === null ? [] : [{ path, content }];
  });
  if (replaced.length) return [...replaced, ...DOCS];
  const path = files['CLAUDE.md'] === undefined ? 'AGENTS.md' : 'CLAUDE.md';
  const existing = (files[path] ?? '').trimEnd();
  return [{ path, content: existing ? `${existing}\n\n${AGENT_SKILLS_BLOCK}` : AGENT_SKILLS_BLOCK }, ...DOCS];
}
