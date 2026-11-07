# Work tracking

The board tracks work saved on this machine and in a repository's issue tracker.

## Language

**Project**:
A repository the board works with, as a person sees it on the board and in Settings.
_Avoid_: repository as the visible name for this. Use repository only for the real GitHub or Azure repository.

**Concept**:
A workspace for understanding an outcome through questions, evidence, decisions and proposed work. Its refinement can finish before its delivery.
_Avoid_: delivery ticket as a synonym for concept.

**Refinement**:
The work of settling a concept's open questions and recording the resulting understanding in its map. Completed refinement does not mean the proposed work has shipped.
_Avoid_: delivery completion.

**Your desk**:
The board's row of items waiting on the user's answer, verification or merge, including shaping work and concepts with an open question.
_Avoid_: inbox, needs-you list.

**Open question**:
A request from a thread, such as a question or tool approval, that T3 holds until the user answers it. A question written in chat text is not one.
_Avoid_: pending input.

**Needs you notice**:
The reason work waits on the user, shown with the actions that resolve it.
_Avoid_: notification, alert.

**Project icon**:
The icon a Project's T3 project shows, either a favicon file or a chosen lucide, emoji or monogram icon.
_Avoid_: repository logo, avatar.

**Abandon**:
Setting work aside on this machine. Closing its linked tracker ticket is a separate, optional action.
_Avoid_: delete work.

**Archive**:
The list in Settings of work that has left the board, including work set aside by Abandon.
_Avoid_: trash, deleted items.

**Spec**:
The refined brief as it appears as a ticket's main description after shaping.
_Avoid_: refined ticket.

**Original**:
The text a ticket had before its first Spec, kept collapsed in the ticket.
_Avoid_: initial ticket.

**Slice**:
A private part of a build that is completed when its work merges into the build branch. Slices appear within their build and are not separate board items.
_Avoid_: sub-ticket.

**Active slice**:
An unfinished, unblocked slice whose implementation thread or its live descendants are currently running. An unavailable activity observation cannot establish that a slice is active.
_Avoid_: In progress slice.

**Deleted thread**:
A T3 thread recorded for an item's work that T3 confirms no longer exists.
_Avoid_: missing thread, lost thread.

**Thread family**:
A work record's T3 threads and their lineage descendants. An item's usage is complete only when its whole thread family has been read.
_Avoid_: thread tree, thread group.

**Thread activity**:
What a thread and its agents are doing now, as T3 reports it: the newest action, its age and the working agents.
_Avoid_: live status, thread progress.

**Agent**:
A native subagent or child task working for a thread.
_Avoid_: worker.

**Quiet thread**:
A thread at work with no new action for 5 minutes and no command or other tool still running. It may be stuck, and the board cannot tell.
_Avoid_: stale thread, stuck thread.

**Start again**:
Opening a new thread for work whose thread was deleted, keeping the work ID.
_Avoid_: restart, retry.

**Shaping thread cleanup**:
What the board does to an item's shaping threads after its build thread is recorded, as the machine's setting chooses.
_Avoid_: thread archive, settling threads.

**Reshape**:
Sending an item with a passing brief back to shaping, keeping the text and requiring a new gate.
_Avoid_: reset, reopen.

**Kind**:
What a piece of work is: Bug, Feature, Improvement or Concept. Builds, decisions and tickets with no recognised kind show as having no kind on rows.
_Avoid_: category, type, label.

**Label**:
A tracker's own name for grouping tickets, called a tag on Azure DevOps.
_Avoid_: custom label.

**Managed label**:
A label the factory reads as meaning, which it hides from rows and locks in settings.
_Avoid_: required label, system label.

**Validation record**:
The broad check runs of a build, each with the tree it tested, its outcome and a log reference, plus each reuse of a result with its stated reason. Later roles read it before running a check again.
_Avoid_: test log, evidence file.

**Heavy command**:
A command that can use much of the machine, as the agent running it declares: a whole test suite, a production build, a performance measurement, or anything expected to run over about a minute. Servers and watchers are never heavy commands.
_Avoid_: expensive check, long command.

**Heavy command limit**:
How many heavy commands may run at once on one machine, across all builds and worktrees.
_Avoid_: budget, concurrency setting.

**Slot**:
Permission to run one heavy command. The heavy command limit is the number of slots.
_Avoid_: lease, token.

**Build limit**:
How many builds may work at once on one machine. Auto-build starts builds only up to this number.
_Avoid_: build slot, concurrency setting.

**Auto-build**:
This machine's choice to have the board start eligible Ready builds by itself, up to the build limit.
_Avoid_: auto-start.

**Model choice**:
The provider instance and model the board starts a thread on, or T3 Project default. When it names the project's default model, the thread also gets that default's options, such as reasoning effort.
_Avoid_: model pick, model setting, T3 default.

**Scope**:
The one Project the board shows, or all Projects.
_Avoid_: project filter, project picker.

**Board search**:
The title bar's field and its dialog, which find tickets, actions and settings and set the board's filters. The List modal and Settings keep their own separate searches.
_Avoid_: command palette, toolbar filters.

**Filter token**:
The mark in the board search for one active Scope, Kind or Labels choice.
_Avoid_: chip.
