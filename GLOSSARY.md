# Mux factory

The Mux factory takes ideas through shaping, building and review to a PR that
Pedro merges. This vocabulary describes its work, roles and board statuses.

## Language

### Work and handover

**Brief**:
The issue's build handover: what to change, how to tell it is done, confirmed
assumptions, builder notes, domain docs drafts and whether Pedro needs to
verify it.
_Avoid_: Specification (when referring to the factory's brief)

**Domain docs**:
A project's glossary and ADRs. Shaping drafts changes to them in the brief, and
the builder writes them in the build PR.

**Prototype**:
A throwaway variant built by a Prototype child task to answer one design
question. The thread that asked for it shows it to Pedro inside T3, in the
integrated browser or the Device panel, so he can pick one.
_Avoid_: Mockup, draft

**Passing brief**:
A brief that has passed the shaping gate and can be handed to a build thread.

**Gate**:
The check before a brief becomes Ready, combining a fresh-context doubt review
with Pedro's answers to remaining assumptions or findings.

**Launch check**:
The pause before a shaping or decision thread starts new threads, listing
exactly which threads it will launch and where the flow goes, until Pedro says
Go.
_Avoid_: Launch confirmation, go/no-go

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
its build and implemented by one implementer. Slices stay off the Mux
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
The two-line text Start sends to a new thread: `#<n> <title>`, then `$mux-work <owner/repo>#<n>`.
_Avoid_: work command, `/mux-work` command

**Model choice**:
The provider instance and model a new thread runs on, picked at Start; "T3 default" leaves it to T3.
_Avoid_: model selection, provider setup

**Repository project**:
The T3 project whose folder is a repository's main checkout; an issue's threads run in its repository's project.
_Avoid_: Mux project, factory project (for where threads run)

**Repository role**:
A one-line description of what a repository is to the others, such as the API server a client app uses.
_Avoid_: relationship, repo type

**Overlay**:
The board's temporary view of successful item creations and status changes
while GitHub catches up; GitHub remains authoritative.
_Avoid_: Source of truth (for the overlay)

### Threads and roles

**Shaping thread**:
The conversation in the issue's repository project that resolves an issue's open
decisions and produces a passing brief before handing off to a build thread.

**Decision thread**:
A top-level thread running `/mux-work` on one `decision: *` sub-issue of a map,
in the repo's main checkout, writing only to issues.
_Avoid_: Decision session

**Build thread**:
The separate conversation that takes a passing brief through implementation,
review and PR checks in its build's repository project, in its own worktree.

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

**Approver**:
The agent that opens the reviewed change's PR and recommends Verify or Ready
to merge; Pedro remains the person who merges it.
_Avoid_: Merger (for the approver)

### Board statuses

**List**:
Captured work that has not yet been selected to start.
_Avoid_: Queued (for unselected work)

**Queued**:
Work Pedro has selected for pickup by mux-work, awaiting an explicit start.
_Avoid_: In progress (for work awaiting pickup)

**Shaping**:
Work whose scope or decisions are being resolved before a build, including a
concept while its decisions remain open.

**Needs you**:
Work waiting for Pedro's input or intervention, such as an answer, a prototype
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
Reviewed work whose required checks have passed and which needs Pedro's hand
check because it is visible, risky or not fully verified by agents.
_Avoid_: Ready to merge (when a hand check remains)

**Ready to merge**:
Reviewed work whose required checks have passed, with no outstanding findings
or hand checks, awaiting Pedro's merge.

**Done**:
Completed work, reached when its issue closes or its PR merges.

**Abandon**:
Discarding a List or Queued item for good. The issue is deleted, or the draft
is removed from the board.
_Avoid_: Cancel, Close (for discarded work)

### Item stats

**Agent time**:
The sum of the work every agent did on an item, with parallel agents added up but a parent's wait on its own subagent counted once, excluding time waiting on Pedro.
_Avoid_: duration, elapsed time

**Wall time**:
The time during which at least one of an item's agents was working, with parallel work counted once, excluding time waiting on Pedro.
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
_Avoid_: cost, spend, price

### Board processes

**Sample board**:
A board process started with `pnpm run sample` on a spare port, reading `board/test/sample.json` instead of GitHub.
_Avoid_: test board, dev board

**Launch-agent board**:
The board process the launch agent runs on the port `config.json` names (4317), which Pedro uses every day.
_Avoid_: live board, real board

### Skills

**Copy**:
A skill or reference taken unchanged from an upstream source and recorded in UPSTREAM.md; it changes only through skill-sync.
_Avoid_: vendored skill, dependency
