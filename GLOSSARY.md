# Work tracking

The board tracks work saved on this machine and in a repository's issue tracker.

## Language

**Project**:
A repository the board works with, as a person sees it on the board and in Settings.
_Avoid_: repository as the visible name for this. Use repository only for the real GitHub or Azure repository.

**Concept**:
A workspace for understanding an outcome through questions, evidence, decisions and proposed work. Its refinement can finish before its delivery. Work across several repositories with open product decisions becomes a Concept, with decisions as parts. `lar-work choose-structure` reads the confirmed scope and makes that choice.
_Avoid_: delivery ticket as a synonym for concept.

**Single-flow issue**:
Work that moves through Queue, Shaping, Ready to build and Build. Its private slices, and sub-issues or Tasks in its own repository, do not change its flow.
_Avoid_: treating a sliced build, or a parent with parts in one repository, as linked work.

**Concepts and linked work**:
Only concepts and their parts, and work whose parent and parts span more than one repository: work that shaping turned into a concept, work that shaping split across repositories, and tracker work already linked across repositories. Settled scope across several repositories uses one parent and one build per repository, with blockers by dependency. Release and activation steps stay on the parent. The board section shows these groups at every stage, including queued concepts with no parts. Human waits also appear on Your desk. A part whose parent is off-board remains reachable here; completed parts remain in their group's history.
_Avoid_: moving grouped parts into single-issue stages.

**Refinement**:
The work of settling a concept's open questions and recording the resulting understanding in its map. Starting Shape authorizes the board to start follow-on decisions with the concept's model choice when their blockers complete, independently of Auto-build. Completed refinement does not mean the proposed work has shipped.
_Avoid_: delivery completion.

**Group reconciliation**:
Keeping a group's map, answers, briefs and blockers coherent after changes. After a part merges, the board settles lifecycle changes and dispatches remaining judgement to one agent owner once the parent and part threads are idle. The board shows “Updating map” or “Reconciling” only while an owner is working; an outstanding checklist alone shows no maintenance warning. Only product questions or approvals wait on the user's desk.
_Avoid_: a manual Reconcile group gate.

**List**:
The place for work that has not been queued, shown in the List modal. Capitalise List in actions and prose, including “Move to List” and “Added to List”.
_Avoid_: inbox, backlog as a name for this place.

**Your desk**:
The board's row of all work waiting on the user: questions, tool approvals, brief gate approvals, PR review and failed starts or stopped runs needing a human retry, whatever its Kind or stage. Each card names its wait and action, Project and concept or parent when present. The item also stays in its group or ordinary stage section. Agent work, blockers, running CI and unknown activity alone do not put work on the desk.
_Avoid_: inbox, needs-you list.

**Open question**:
A request from a thread, such as a question or tool approval, that T3 holds until the user answers it. A question written in chat text is not one.
T3's pending request puts it on Your desk and removes it when answered; an ordinary question does not also save a Needs you notice or change the work's Status.
_Avoid_: pending input.

**Needs you notice**:
The reason work waits on the user, shown with the actions that resolve it. A question’s notice clears as soon as a current T3 read shows that request gone; unrelated notices remain.
_Avoid_: notification, alert.

**Project icon**:
The icon a Project's T3 project shows, either a favicon file or a chosen lucide, emoji or monogram icon.
_Avoid_: repository logo, avatar.

**Abandon**:
Setting work aside on this machine. Closing its linked tracker ticket is a separate, optional action.
_Avoid_: delete work.

**Archive**:
The list in Settings of work that has left the board, including work set aside by Abandon or closed during shaping. Work closed during shaping keeps its one-line reason and remains findable in Board search until the retention setting deletes it.
_Avoid_: trash, deleted items.

**Spec**:
The refined brief as it appears as a ticket's main description after shaping. Its Confirmed section holds product decisions only and is omitted when empty. The final brief gate is its approval; settled work can take its scope from the submitted request, including each repository's named role in a linked outcome, without a separate confirmation question. Repository involvement left open by the request still needs an answer.
Linked-work graph and consumption declarations remain in the local brief, outside the published prose.
A human PR change request the user chooses to address can amend affected linked
Specs, the parent map and Outcome together. The producer owns that amendment;
consumers need no PR or repeated brief approval. Its receipt binds the corrected
content and authorizing comment.
_Avoid_: refined ticket.

**Doubt**:
An independent review that tries to disprove a brief against the code before the gate, reporting only what would make the build wrong or leave a product decision open.
_Avoid_: audit.

**Original**:
The authored text a ticket had before its first Spec, kept collapsed in the ticket when nonempty. Temporary creation metadata is excluded.
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
During a failed read, the board keeps the last action for up to 15 seconds from its original read time. Cached thread
state stays marked as cached and cannot establish that work is running or a human wait has cleared.
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
What a piece of work is: Bug, Feature, Improvement or Concept. Single-flow shaping keeps Bug, Feature and Improvement alongside its internal build workflow. Builds with no saved Kind, decisions and tickets with no recognised kind show as having no kind on rows.
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
How many builds may work at once on one machine. A build whose PR is open is waiting on its PR and doesn't count, even while it fixes CI or review feedback. At capacity, Build arms Start after a slot frees, even with Auto-build off; its chevron offers Start now (over the limit). Auto-build starts builds only up to this number.
Its occupancy includes builds inside Concepts and linked work. The Single-issue builds section counts only its own rows; grouped builds stay in their groups, where every project lane names its project.
_Avoid_: build slot, concurrency setting.

**Auto-build**:
This machine's choice to have the board start eligible Ready builds by itself, up to the build limit.
_Avoid_: auto-start.

**Build method**:
How the agent works inside a build's steps: TDD (test first) or Prove it (build, then prove by reproduction, driving the feature and the repo's checks). Each project sets one, and a run keeps the method it started with.
_Avoid_: testing mode, build style.

**Retro**:
The build's look back at its own work, run when its PR opens before waiting for CI, which proposes useful excluded product work, deferred reviewer findings and improvements to future runs for you to choose on the board. Follow-ups never hold delivery or a build slot. An unanswered pick stays on the desk and in the Done item until you choose or dismiss it; retention keeps it visible and saved until then. A factory-wide switch, on by default, turns it off, and a run keeps the choice it started with.
_Avoid_: retrospective, post-merge retro.

**Model choice**:
The provider instance and model the board starts a thread on, or Project default in T3. Shape, Build and Decide start with the last used choice while it is still offered, otherwise Project default in T3; their adjacent chevron opens the model menu. When the choice names the project's default model, the thread also gets that default's options, such as reasoning effort.
_Avoid_: model pick, model setting, T3 default.

**Release folder**:
The copy of one app release's factory skills that the app keeps in its data folder. A run reads skills from the release folder it started with while that folder exists, and otherwise from the running release.
_Avoid_: installed skills, skill install.

**Scope**:
The one Project the board shows, or all Projects.
_Avoid_: project filter, project picker.

**Board search**:
The title bar's field and its dialog, which find tickets, actions and settings and set the board's filters. The List modal and Settings keep their own separate searches.
_Avoid_: command palette, toolbar filters.

**Filter token**:
The mark in the board search for one active Scope, Kind or Labels choice.
_Avoid_: chip.

**Open questions in a concept map**:
Unresolved questions recorded by shaping. The stored map calls these `fog`; the board calls them open questions.
_Avoid_: Fog as a visible label.

**Clarification**:
A decision explored by asking focused questions. Its stored method remains `grill`.
_Avoid_: Grill as a visible method name.

**Outcome check**:
The final check that the concept’s proposed work achieves its intended outcome. While its dispatched owner is working, the board says “Checking Outcome”.
_Avoid_: end-to-end check as a visible map label.

**Start shaping**, **Start decision**, **Start build**:
The action names the work it begins on every row, map node and item detail. A deferred action also names its prerequisite (for example, “Start build after #42”); armed work reads “Starts build after #42”.

**PR review**:

The single human review of a delivered build, including its PR's Test steps.
Humans merge. The factory's reviewers run before the PR opens and finish the
fresh feedback review cycle before a review fix is pushed. Approver reassessment
also finishes on the final tree before that push. The build thread
hands back when the open delivery PR has green required checks and no selected
feedback in hand. Its part is done: the row says Ready to merge and the desk says
Review PR #n. It holds no build slot, never merges, and never parses comments or
reviews as merge approval. The item dialog retains an explicit human-operated
merge fallback using the provider's policies and expected-head guard.

The board's PR observer automatically wakes the idle build owner once per new
required-check failure or conflict, with durable delivery receipts. Human feedback
instead puts one New comment on PR #n card on that item, with its gist and Address
it, Open thread and Dismiss. Multiple new comments collapse into one card. Address
it immediately shows Sending…, then sends the chosen current unresolved comments through the existing dispatch path;
Open thread opens T3 for a direct conversation; Dismiss permanently retires the
shown comments. Only unresolved GitHub inline review threads (reviewThreads
isResolved, isOutdated and comments) or active Azure threads count. Resolved/fixed/
closed threads leave the card, including at the fresh Address it read, and are
never sent. Outdated alone is not resolved. GitHub top-level comments and review
summaries cannot be resolved and remain until addressed or dismissed. A fix push
during direct owner work retires the comments present when that work began; later
comments stay pending. A recorded agent reply to an inline comment handles that
comment without resolving its conversation. Idle pushes and unrelated replies do
not retire feedback. Bots and recorded agent replies do
not become human feedback.

Whenever the build owner or its reviewers work on the PR again, including after
the user starts work directly in T3, the row says Fixing review feedback and no PR
desk card appears; an optional Retro card can remain with the working headline
and Choose follow-ups (optional) as secondary text. Optional picks never outrank
active owner work. Handback with
green required checks restores unhandled feedback or review readiness. The row
and card name observed merge blockers instead of claiming Ready to merge.
Merged PRs never request review. A merge by anyone records Done automatically;
the board retries existing guarded branch/worktree cleanup once active work ends,
without waking the build owner. Closed unmerged PRs keep a clear notice and their
unmerged work. Retro picks after Done are independent.

A trusted PR request the user chooses to address can amend the Spec without a new
human gate. Record begin-pr-amendment before scope or brief writes. While fresh
Doubt and the correction are in hand, suppress the duplicate gate and retain the
tracker's last published Spec. approve-pr-amendment records the exact corrected
gate and retires the marker together, then publishes the corrected Spec. Only a
real unresolved conflict becomes a desk question.
