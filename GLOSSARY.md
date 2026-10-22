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

**Passing brief**:
A brief that has passed the shaping gate and can be handed to a build thread.

**Gate**:
The check before a brief becomes Ready, combining a fresh-context doubt review
with Pedro's answers to remaining assumptions or findings.

**Concept**:
Work too broad or unclear for a single brief, represented by a map issue with
decision and build sub-issues.

**Map**:
A concept's account of its destination, decisions so far, remaining fog,
out-of-scope work, domain docs drafts and relationships between sub-issues.

**Build**:
An issue that becomes one PR, delivered through its slices.
_Avoid_: build issue

**Slice**:
A small, independently testable piece of a build, recorded as a sub-issue of
the build issue and implemented by one subagent.
_Avoid_: ticket, chunk, task

**Active slice**:
A slice an implementer is working on right now.
_Avoid_: in-progress slice, current slice

**Work message**:
The two-line text a Queued card copies and Start sends: `#<n> <title>`, then `$mux-work <owner/repo>#<n>`.
_Avoid_: work command, `/mux-work` command

**Overlay**:
The board's temporary view of successful item creations and status changes
while GitHub catches up; GitHub remains authoritative.
_Avoid_: Source of truth (for the overlay)

### Threads and roles

**Shaping thread**:
The conversation that resolves an issue's open decisions and produces a passing
brief before handing off to a build thread.

**Build thread**:
The separate conversation that takes a passing brief through implementation,
review and PR checks in the issue repository's own workspace.

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
