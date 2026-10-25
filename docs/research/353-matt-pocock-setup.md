# What Matt Pocock's skills setup writes, and where it clashes with the factory

Research for [#353](https://github.com/maddec01/mux-factory/issues/353), part of the #70 map.

The setup skill is `setup-matt-pocock-skills`, read at `mattpocock/skills` commit
[`5beb35b`](https://github.com/mattpocock/skills/tree/5beb35b040e3de97e54fa9e386d7e42d15c295c2),
the commit `UPSTREAM.md` records. On 2026-10-25 that commit is still the head of `main`
(`gh api repos/mattpocock/skills/commits/HEAD` returns `5beb35b…`), so the recorded commit and
current main are the same tree and nothing changed between them. Older versions of the setup
wrote different file names; [Older versions](#older-versions) lists them, since a repo set up
months ago carries the old names. Below, `setup/` stands for
[`skills/engineering/setup-matt-pocock-skills/`](https://github.com/mattpocock/skills/tree/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills)
at `5beb35b`. The factory was read at `origin/main` on 2026-10-25.

## Summary

- The setup writes four things into the repo and one into the tracker: an `## Agent skills`
  block in `CLAUDE.md` or `AGENTS.md`, `docs/agents/issue-tracker.md`, `docs/agents/domain.md`,
  `docs/agents/triage-labels.md` (only when the `triage` skill is installed), and five triage
  labels on GitHub or GitLab (only then, and only since 2026-10-07). It creates no
  `GLOSSARY.md` and no `docs/adr/`.
- Three of them clash with the factory: the `## Agent skills` block, `issue-tracker.md` and
  `triage-labels.md` with its labels. They tell agents to track work by triage labels, a
  `wayfinder:map` issue and assignee claims, where the factory uses Project Status, a `concept`
  map with `decision: *` labels, and an `active` label.
- `domain.md` agrees with the factory's layout: one root `GLOSSARY.md` and `docs/adr/`. It only
  clashes when the repo chose multi-context (`GLOSSARY-MAP.md`) or still uses the old
  `CONTEXT.md` name.
- Sub-issues and blocked-by agree. The GitHub template uses native sub-issues and native issue
  dependencies, as `skills/mux-work/issue-tracker.md` does.
- Detection is file and heading checks plus one label listing. Every signal is a fixed string.
- Two configured repos, `mux-server` and `mux-apple`, already ran the setup and were then
  rewritten by hand to describe the factory. They show the "rewrite, don't delete" cleanup
  already in use.

## What the setup writes

The setup explores first, presents what it found, confirms each section with the user and then
writes ([`setup/SKILL.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/SKILL.md),
"This is a prompt-driven skill"). So the output varies with the user's answers; the templates
below are its starting point.

### The `## Agent skills` block

It edits `CLAUDE.md` if that exists, else `AGENTS.md`, and asks which to create when neither
exists. It never creates one when the other exists. An existing `## Agent skills` block is
updated in place ([`setup/SKILL.md`, step 4](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/SKILL.md)).
The block has three sub-blocks, each a one-line summary and a pointer:

```markdown
## Agent skills

### Issue tracker
[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels
[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs
[one-line summary of layout: "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

`### Triage labels` is left out when `triage` isn't installed (same file). The block is how the
other skills find the config. The factory's own copies of `to-tickets` and `code-review` open
with "The issue tracker … should have been provided to you. If not, tell the user to run
`/setup-matt-pocock-skills`" (`skills/to-tickets/SKILL.md` line 11, `skills/code-review/SKILL.md`
line 13; upstream [`to-tickets`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/to-tickets/SKILL.md)
and [`triage`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/triage/SKILL.md)
say the same).

### Issue tracker configuration: `docs/agents/issue-tracker.md`

One of four, chosen in Section A. The setup proposes GitHub when a remote points at GitHub and
GitLab when it points at GitLab ([`setup/SKILL.md`, Section A](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/SKILL.md)).

- **GitHub** ([`setup/issue-tracker-github.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md)):
  `gh` commands to create, read, list, comment, label and close issues; sub-issues through
  `gh issue create --parent` or the REST `sub_issues` endpoint; a "PRs as a request surface: no"
  flag that `triage` reads; and a `## Wayfinding operations` section. That section defines a map
  as an issue labelled `wayfinder:map`, child tickets labelled `wayfinder:<type>` (`research`,
  `prototype`, `grilling`, `task`), blocking through native issue dependencies, and claiming a
  ticket by assigning it (`gh issue edit <n> --add-assignee @me`).
- **GitLab** ([`setup/issue-tracker-gitlab.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/issue-tracker-gitlab.md)):
  the same shape with `glab`, `Part of #<map>` lines instead of sub-issues, and the
  `/blocked_by` quick action.
- **Local markdown** ([`setup/issue-tracker-local.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md)):
  issues are files under `.scratch/<feature-slug>/issues/NN-<slug>.md` with a `Status:` line,
  and wayfinder maps are `.scratch/<effort>/map.md`.
- **Other**: freeform prose from the user. The upstream docs page names Jira, Linear, Azure DevOps
  and Beads as users of this path
  ([`docs/engineering/setup-matt-pocock-skills.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/docs/engineering/setup-matt-pocock-skills.md)).
  There is no fixed heading to detect.

### Triage labels: `docs/agents/triage-labels.md` and tracker labels

Written only when the `triage` skill is installed (Section B). It maps five canonical roles to
the repo's label strings, by default the same strings: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`
([`setup/triage-labels.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/triage-labels.md)).
On GitHub or GitLab it then creates each configured label the tracker lacks with
`gh label create` or `glab label create` ([`setup/SKILL.md`, step 4](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/SKILL.md)).
`triage` also uses two category roles, `bug` and `enhancement`, which the setup doesn't map
([`triage/SKILL.md`, Roles](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/triage/SKILL.md)).

### Domain docs: `docs/agents/domain.md`

The setup writes single-context without asking. It offers multi-context (a root
`GLOSSARY-MAP.md` pointing at one `GLOSSARY.md` per context, with `src/<context>/docs/adr/`) only
when it sees monorepo signals: `pnpm-workspace.yaml`, a `workspaces` field, or a populated
`packages/*` ([`setup/SKILL.md`, Sections 1 and C](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/SKILL.md)).
`domain.md` tells agents to read `GLOSSARY.md` (or `GLOSSARY-MAP.md`) and `docs/adr/`, to
"proceed silently" when they don't exist, to use the glossary's terms, and to flag ADR
contradictions ([`setup/domain.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/setup-matt-pocock-skills/domain.md)).
The setup creates neither file; `domain-modeling` creates them when a term or decision settles
(same file).

### Written later by the skills it configures

Not setup output, but a repo that used the skills may have them:

- `wayfinder:map` and `wayfinder:<type>` labels, used by
  [`wayfinder`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/wayfinder/SKILL.md).
  Both configured app repos carry all five. Which step creates them is unconfirmed: the setup
  doesn't, and `wayfinder` only says to create the map with `--label wayfinder:map`.
- A `.out-of-scope/` directory of rejected requests, written by `triage`
  ([`triage/OUT-OF-SCOPE.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/triage/OUT-OF-SCOPE.md)).
- `.scratch/` issue files, under the local-markdown tracker.

## Clashes, detection and cleanup

The factory's ticket rules are in `skills/mux-work/SKILL.md` and `skills/mux-work/issue-tracker.md`:
Project Status values (List to Done) instead of state labels, a `concept` map whose sub-issues
carry `decision: grill|prototype|research|task` or `build`, slices marked with `active` and
`blocked`, and native sub-issues and blocked-by links. Detection commands run from the repo root;
`$repo` is `owner/name`.

| What the setup writes | What it is | Clashes with the factory? | How to detect | What cleanup involves |
| --- | --- | --- | --- | --- |
| `## Agent skills` block in `CLAUDE.md` or `AGENTS.md` | Pointers from every upstream skill to `docs/agents/*` | Yes. It is a second answer to "where do tickets go and how are they labelled", which agents read before any factory rule | `grep -n '^## Agent skills' CLAUDE.md AGENTS.md` | Rewrite the `Issue tracker` and `Triage labels` sub-blocks to point at the factory's tracking, and keep `Domain docs`. Deleting the whole block makes the factory's `to-tickets` and `code-review` copies tell the user to run the setup |
| `docs/agents/issue-tracker.md`, GitHub template | `gh` conventions, PR triage flag, wayfinder operations | Partly. Create, read, comment, sub-issue and blocked-by match the factory. `## Wayfinding operations` defines a second map (`wayfinder:map`, `wayfinder:<type>`) and claims by assignee, where the factory uses `concept`, `decision: *` and `active` | File exists and its first line is `# Issue tracker: GitHub`; grep `^## Wayfinding operations` | Replace the wayfinding section with the factory's concept rules, or delete the file and the block's pointer together |
| `docs/agents/issue-tracker.md`, GitLab template | `glab` conventions | Yes, for an onboarding that takes GitHub or Azure DevOps. The tracker itself differs | First line `# Issue tracker: GitLab` | Tell the user the repo tracks work elsewhere; onboarding can't adopt it without moving the issues |
| `docs/agents/issue-tracker.md`, local markdown | Issues as `.scratch/` files with `Status:` lines | Yes. Tickets live in files, not in the item's ticket and its children (#70 Destination) | First line `# Issue tracker: Local Markdown`; a `.scratch/` directory | Same as GitLab: open `.scratch/` issues would need moving by hand. Deleting the file loses nothing tracked elsewhere |
| `docs/agents/issue-tracker.md`, "Other" | Freeform prose | Unknown until read | File exists with none of the three headings | Show the file to the user and ask |
| `docs/agents/triage-labels.md` | Role-to-label table | Yes. It makes workflow state a label, where the factory makes it a Project Status | File exists; grep `Label in mattpocock/skills` | Delete, or rewrite as the factory's labels and statuses, as the app repos did |
| Five triage labels on GitHub or GitLab | `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (or the user's overrides) | Yes, if issues carry them: a second state next to Status. `wontfix` alone means nothing, since GitHub creates it in every new repo ([GitHub docs, default labels](https://github.com/github/docs/blob/02c25d16369fe27f9bdb28d1201f6b452f0d21dd/content/issues/using-labels-and-milestones-to-track-work/managing-labels.md#about-default-labels)) | `gh api --paginate "repos/$repo/labels" --jq '.[].name'` and look for `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`; count open issues with `gh issue list --repo "$repo" --label <name> --state open` | Leave them unless the user asks. Deleting a label removes it from every issue and PR that has it ([GitHub docs, deleting a label](https://github.com/github/docs/blob/02c25d16369fe27f9bdb28d1201f6b452f0d21dd/content/issues/using-labels-and-milestones-to-track-work/managing-labels.md#deleting-a-label)), so show the counts first |
| `docs/agents/domain.md`, single-context | Rules for reading `GLOSSARY.md` and `docs/adr/` | No. Same layout and rules as the factory's | File exists; grep `^# Domain Docs` | Keep it. Onboarding reuses existing `GLOSSARY.md` and ADRs and never overwrites them |
| `docs/agents/domain.md`, multi-context | `GLOSSARY-MAP.md` plus per-context glossaries | Yes, if the factory stays single-context: `mux-work` reads one root `GLOSSARY.md` | `GLOSSARY-MAP.md` at the root | Ask the user. Merging glossaries is the kind of automatic change #70 rules out |
| Legacy `CONTEXT.md` / `CONTEXT-MAP.md` | The glossary under its name before 2026-08-15 | Yes, by name only: the factory looks for `GLOSSARY.md` | `CONTEXT.md` or `CONTEXT-MAP.md` at the root | Offer `git mv CONTEXT.md GLOSSARY.md` and fix the pointer in `domain.md` |
| Legacy `docs/agents/backlog.md` | The tracker file under its name from the first version | Same as `issue-tracker.md` | File exists | Same as `issue-tracker.md` |

## Older versions

The detection list above covers these because they change file names
(`git log -- skills/engineering/setup-matt-pocock-skills` in a clone):

- [`7afa86d`](https://github.com/mattpocock/skills/commit/7afa86d3a5dd96edde06ffa014e16c64e733681e)
  (2026-04-28), the first version, wrote `docs/agents/backlog.md` and preferred `AGENTS.md` over
  `CLAUDE.md`. [`70653e1`](https://github.com/mattpocock/skills/commit/70653e105c64f31777d5e85cdecdb33bbf4f9482)
  switched to `CLAUDE.md` first and
  [`179a14e`](https://github.com/mattpocock/skills/commit/179a14e721034706ffce7abae75b877c922b4ae8)
  renamed `backlog.md` to `issue-tracker.md`, both the same day. A repo can therefore have the
  block in either file.
- [`44eed54`](https://github.com/mattpocock/skills/commit/44eed545186ffd0263e8004867750b80cfddd215)
  (2026-07-10) made `triage-labels.md` conditional on `triage` being installed. Before it, every
  run wrote the file.
- [`d80fa0f`](https://github.com/mattpocock/skills/commit/d80fa0f4ebe0c5714af0adf8670336065233ecc6)
  (2026-08-15) renamed `CONTEXT.md` and `CONTEXT-MAP.md` to `GLOSSARY.md` and `GLOSSARY-MAP.md`.
- [`5b7cade`](https://github.com/mattpocock/skills/commit/5b7cade4d68947f34dae71326a0ce89f09e22c9c)
  (2026-10-07) added creating the triage labels on the tracker. A repo set up before it has the
  file but maybe not the labels.

## The two app repos already show the result

`maddec01/mux-server` and `maddec01/mux-apple` both have `docs/agents/issue-tracker.md`,
`domain.md` and `triage-labels.md`, and their labels include all four non-default triage
labels and the five `wayfinder:` labels (read with `gh api` on 2026-10-25). Their
`triage-labels.md` was rewritten to `# Board and labels`, describing Project Status, and their
`issue-tracker.md` keeps the GitHub template's conventions with a `## Concepts` section in place
of `## Wayfinding operations`. `mux-apple` keeps an `## Agent skills` block whose triage
sub-block became `### Board and labels`; `mux-server` replaced the block with an
`## Agent references` list. `docs/plan.md` (Phase 1, mux-server step 2) is where that rewrite was planned.
The labels were left in place. `mux-factory` itself has no `docs/agents/` and no block.

## Open questions for Pedro

These belong to #362 (conflict checks and cleanup):

- Rewrite or delete. The app repos kept `docs/agents/` and rewrote it. Onboarding could do the
  same, which keeps the upstream skill copies from asking for the setup, or delete the files and
  give those copies another pointer.
- Whether onboarding offers to delete the triage labels at all, or only reports them with their
  issue counts.
- What counts as "the setup ran". Any one of the block heading, `docs/agents/issue-tracker.md` or
  `docs/agents/backlog.md` is a reliable signal. The labels alone are weaker, since a repo can
  have `needs-triage` from other tools.

## Unconfirmed

- Which step creates the `wayfinder:` labels. Neither the setup nor `wayfinder` at `5beb35b`
  says to run `gh label create` for them.
- Whether removing the block matters in practice. `mux-work` doesn't load `code-review`, and its
  planner already overrides `to-tickets`' tracker setup (`skills/mux-work/agents/planner.md`), so
  the setup prompt would only show when a user runs those skills by hand.
