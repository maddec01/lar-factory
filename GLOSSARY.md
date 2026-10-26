# Lar Factory

Lar Factory takes ideas through shaping, building and review to a PR that
the user merges. This vocabulary describes its work, roles and board statuses.

## Language

### Work and handover

**Brief**:
The issue's build handover: what to change, how to tell it is done, confirmed
assumptions, builder notes, domain docs drafts and whether the user needs to
verify it.
_Avoid_: Specification (when referring to the factory's brief)

**Domain docs**:
A project's glossary and ADRs. Shaping drafts changes to them in the brief, and
the builder writes them in the build PR.

**Prototype**:
A throwaway variant built by a Prototype child task to answer one design
question. The thread that asked for it shows it to the user inside T3, in the
integrated browser or the Device panel, so they can pick one.
_Avoid_: Mockup, draft

**Passing brief**:
A brief that has passed the shaping gate and can be handed to a build thread.

**Gate**:
The check before a brief becomes Ready, combining a fresh-context doubt review
with the user's answers to remaining assumptions or findings.

**Concept**:
Work too broad or unclear for a single brief, represented by a map issue with
decision and build sub-issues. Spanning several repositories doesn't by itself
make work a concept.

**Map**:
A concept's account of its destination, decisions so far, remaining fog,
out-of-scope work, domain docs drafts and relationships between sub-issues.

**Build**:
An issue in one repository that changes only that repository and becomes one
PR there, delivered through its slices.
_Avoid_: build issue

**Slice**:
A small, independently testable piece of a build, recorded as a sub-issue of
its build and implemented by one implementer. Slices stay off the lar
board. A sub-issue labelled `build` is a build, never a slice.
_Avoid_: ticket, chunk, task

**Active slice**:
A slice an implementer is working on right now.
_Avoid_: in-progress slice, current slice

**Blocked slice**:
A slice an implementer couldn't finish, waiting for a re-slice; it carries the
`blocked` label. Not a slice with an open blocked-by link.
_Avoid_: failed slice, stuck slice

**Re-slice**:
A planner's in-place rewrite of a blocked slice and the build's other open
slices that aren't active.
_Avoid_: re-plan

**Work message**:
The two-line text the board sends to a new shaping or decision thread: `#<n> <title>`, then `$lar-work <owner/repo>#<n>`.
_Avoid_: work command, `/lar-work` command

**Model choice**:
The provider instance and model a new thread runs on, picked at Start; "T3 default" leaves it to T3.
_Avoid_: model selection, provider setup

**Repository project**:
The T3 project whose folder is a repository's main checkout, recognised by its git origin; an issue's threads run in its repository's project.
_Avoid_: lar project, factory project (for where threads run)

**Repository role**:
A one-line description of what a repository is to the others, such as the API server a client app uses.
_Avoid_: relationship, repo type

**Repository config**:
One repository's factory settings (its role, item source, show setting and labels), kept in that repository so everyone who onboards it gets the same setup.
_Avoid_: onboarding config, project config, board config

**Overlay**:
The board's temporary view of successful item creations and status changes
while GitHub catches up; GitHub remains authoritative.
_Avoid_: Source of truth (for the overlay)

### Threads and roles

**User**:
The person who installs the board app and runs the factory on their own repositories.
_Avoid_: owner

**Maintainer**:
The person who keeps lar-factory itself: syncs the skill Copies with upstream and starts Releases.
_Avoid_: owner, author

**Shaping thread**:
The conversation in the issue's repository project that resolves an issue's open
decisions and produces a passing brief, then stops at Ready.

**Decision thread**:
A top-level thread, started from the board, running `/lar-work` on one `decision: *` sub-issue of a map,
in the repo's main checkout, writing only to issues.
_Avoid_: Decision session

**Build thread**:
The conversation Start build opens in its build's repository project, in its
own worktree, that takes a passing brief through implementation, review and PR
checks.

**Item thread**:
A T3 thread whose first message names the item, before any other issue. Its
state is running, needs you or done.

**Planner**:
The agent a build thread starts to split its build into slices or to re-slice a
blocked slice.
_Avoid_: slicer, ticket writer

**Child task**:
Delegated work a thread owns and addresses only by its task ID; its backing thread is never used as a conversation.
_Avoid_: delegated thread, child thread

**Subagent**:
An agent a thread's provider starts natively to do part of the thread's work, running in its own thread beneath it.
T3 stores child tasks the same way and tells them apart only by who started them.
_Avoid_: child task (for native subagents), helper

**Reviewer**:
A fresh-context agent assessing a change on one review axis: code, security,
UX or UI.

**Review round**:
One pass of the reviewers over a diff. The first covers the whole branch; each later one covers only the fixes from the round before, with at most three per build.
_Avoid_: Review pass, re-review

**Approver**:
The agent that opens the reviewed change's PR and recommends Verify or Ready
to merge; the user remains the person who merges it.
_Avoid_: Merger (for the approver)

### Board statuses

**Status**:
An item's place in the factory's flow, one of the board statuses, kept on the item itself in the form its item source allows. Done is never stored; it follows from the item closing.
_Avoid_: column, state, stage

**List**:
Captured work that has not yet been selected to start.
_Avoid_: Queued (for unselected work)

**Queued**:
Work selected for pickup by lar-work, by the user or by its concept's shaping,
awaiting a start from the board.
_Avoid_: In progress (for work awaiting pickup)

**Shaping**:
Work whose scope or decisions are being resolved before a build, including a
concept while its decisions remain open.

**Needs you**:
Work waiting for the user's input or intervention, such as an answer, a prototype
choice or help with a blocked check.

**Ready**:
Work with a passing brief, ready for its build to start.
_Avoid_: Ready to merge (for work ready to build)

**In progress**:
Work being implemented by its build thread.

**Review**:
Work undergoing review and any fixes, including the wait for its PR's required
checks before the recommended status takes effect.

**Verify**:
Reviewed work whose required checks have passed and which needs the user's hand
check because it is visible, risky or not fully verified by agents.
_Avoid_: Ready to merge (when a hand check remains)

**Ready to merge**:
Reviewed work whose required checks have passed, with no outstanding findings
or hand checks, awaiting the user's merge.

**Done**:
Completed work, reached when its item closes or its PR merges.

**Abandon**:
Discarding a List or Queued item for good. The issue is deleted, or the draft
is removed from the board.
_Avoid_: Cancel, Close (for discarded work)

### Item stats

**Agent time**:
The sum of the work every agent did on an item, with parallel agents added up but a parent's wait on its own subagent counted once, excluding time waiting on the user.
_Avoid_: duration, elapsed time

**Wall time**:
The time during which at least one of an item's agents was working, with parallel work counted once, excluding time waiting on the user.
_Avoid_: elapsed time, calendar time, active time

**Item stats**:
An item's agent time, wall time, total tokens and API cost, shown as four plain figures.
They cover the threads whose first message names this item before any other issue, with those threads' child tasks and subagents.
_Avoid_: usage, metrics

**Item total**:
An item's stats plus the item total of each of its sub-issues on the board.
_Avoid_: report total, aggregate, rollup

**API cost**:
What an item's tokens would cost at API list prices, as T3 Code estimates it, rather than the subscription bill.
_Avoid_: cost, price

### Board server and page

**Board server**:
The local process that reads each repository's provider and T3 and serves the board.
_Avoid_: board process, backend

**Board page**:
The board's web UI, shown in the board app or in a browser.
_Avoid_: frontend, board UI

**Sample board**:
A board server started with `pnpm run sample` on a spare port, reading `packages/shared/test/sample.json` instead of GitHub.
_Avoid_: test board, dev board

**Board app**:
The installable desktop app that runs the board and updates itself from Releases.
_Avoid_: Electron app, desktop board

**Title bar**:
The bar at the top of the main area, in the board app and in a browser. It holds the scope, the Refreshed time and the counters. The brand sits in the sidebar's top row.
_Avoid_: toolbar, top bar

**Sidebar**:
The resizable column on the left of the board, beside the main area. The brand sits in its top row; Settings and the Update button sit in its foot.
_Avoid_: drawer, nav, side panel

**Provider**:
The service that hosts a repository and its tickets: GitHub or Azure DevOps.
_Avoid_: platform, board provider, host

**Item source**:
Where the board finds one repository's items: a GitHub Project, the repository's issues, an Azure DevOps team's current sprint, or that team's backlog. It lists the items that can show.
_Avoid_: list source, board source, project

**Show setting**:
A repository's choice of which items the board shows: All items, every open item its item source lists, or Opted-in items, only those that carry a status.
_Avoid_: filter, visibility

**Opt-in**:
A repository's choice to show only items that carry a status, instead of every open item its item source lists.
_Avoid_: filter, allowlist

**Scope**:
The repository the board shows, picked in the title bar or the sidebar, or all repositories.
_Avoid_: project, filter, platform

**Desk**:
The row of items only the user can move on: Ready, Needs you, Verify and Ready to merge. Each card has the button for its next action.
_Avoid_: inbox, queue

**Line**:
The board's view of the work moving through the factory: the Queue, the dossiers, and everything else in flight on one stage track.

**Dossier**:
A concept, or an item with sub-issues, shown whole on the line: its destination, decisions, parts, what waits on what, and its threads.
_Avoid_: concept card

**Refining**:
The line's first stage, covering Shaping and Needs you. Start refining starts an item's shaping thread.
_Avoid_: shaping (for the stage)

**Start build**:
The board action that starts a Ready build's thread in its own worktree.
_Avoid_: launch

**Start after**:
Arming a blocked part's start, so the board starts it once every issue it's blocked by closes.
_Avoid_: auto-start (for this)

**Design system**:
The package that holds every token, style and base component of the board page and the board app's starting page; nothing outside it sets its own colours or spacing.
_Avoid_: UI kit, component library, theme

### Upstream files

**Copy**:
A file taken unchanged from an upstream source and recorded in its folder's record (UPSTREAM.md for skills and checklists, the copy record for design system components); it changes only through a fresh copy from upstream.
_Avoid_: vendored file, dependency

**Override**:
A lar rule, written in one of lar's own skills, that replaces or sets aside part of a Copy's instructions.
_Avoid_: patch, tweak, local change

**Port**:
A file adapted from upstream code that names its source and commit in its header; we edit it freely.
_Avoid_: copy, vendored file

### Skills

**Checklist**:
A shared reference file that several skills link to, installed next to the skills.
_Avoid_: reference, reference file

**Claude profile**:
One Claude Code config folder (`~/.claude` or a `~/.claude-*` folder) with its own login and its own skills.
_Avoid_: Claude instance, config dir

### Releases

**Release**:
A published version of the board app, made by CI from a commit on main whose checks passed.
_Avoid_: build, version

**Nightly**:
A Release marked as a prerelease, which the maintainer publishes by hand from main's head once its checks pass; the name comes from T3 Code.
_Avoid_: nightly build, preview

**Stable Release**:
A Release the maintainer publishes by hand from the latest Nightly's commit, which the app's latest channel follows.
_Avoid_: production release
