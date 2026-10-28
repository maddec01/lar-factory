# Issue tracker: GitHub

Issues and PRs for this repository live in its GitHub issues, and Lar Factory's
board moves them through their Status. Use the `gh` CLI with the local login;
it infers the repository from `git remote -v` when run inside a clone.

## Conventions

- Create an issue: `gh issue create --title "..." --body-file <file> --label <kind>`,
  where the kind is `bug`, `feature` or `improvement` (see `docs/agents/triage-labels.md`).
- Read an issue: `gh issue view <number> --comments`.
- List issues: `gh issue list --state open --json number,title,labels`.
- Comment: `gh issue comment <number> --body-file <file>`.
- Add or remove a label: `gh issue edit <number> --add-label <label>` or `--remove-label <label>`.
- Close: `gh issue close <number> --reason completed`, or `--reason "not planned"`.
- Make a sub-issue: `gh issue create --parent <number> ...`, or
  `gh issue edit <parent> --add-sub-issue <child>` for an existing issue.
- Mark a blocker: `gh issue edit <child> --add-blocked-by <blocker>`.

Sub-issues and blocked-by are GitHub's native relationships. A `Part of #n`
mention creates neither.

## Status

Each item has one Status: List, Queued, Shaping, Needs you, Ready, In progress,
Review, Verify, Ready to merge or Done. It lives as one
`status-<name>` label on the issue, such as `status-needs-you`. Move an item
with the `lar-work` skill's `scripts/status.sh <issue-url> "<Status>"`. Closing
an issue makes it Done. State lives in Status alone, so assignees and other
labels stay free of it.

## Concepts

Work too broad or unclear for one issue is a `concept` issue: a map whose
native sub-issues are decisions (`decision-grill`, `decision-prototype`,
`decision-research`, `decision-task`) and builds (`build`). A build becomes
one PR, and its slices are its sub-issues. The `lar-work` skill runs this
workflow; read it before shaping, slicing or building.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in this repository with `gh issue create`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
