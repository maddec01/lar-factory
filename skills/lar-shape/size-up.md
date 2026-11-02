# 2. Size up


After reading the item and lightweight exploration, present the expected
outcome, affected repositories, open questions or "none", and proposed next
step in plain words. Ask the user to confirm or amend this understanding through
[Questions](shared/questions.md). Wait for explicit confirmation before diagnosis,
grilling, prototypes or brief drafting, even for a fully specified issue.
Incorporate amendments and present the revised understanding for confirmation.
Silence leaves the checkpoint pending in Needs you.

On resume, reuse an explicit confirmation recorded in the thread or the brief's
Confirmed section only when the proposed understanding is unchanged. Keep the
confirmed understanding and the user's answer together for that comparison.
Otherwise ask again. Ready commits the user to no build; Start build remains a
separate user action.

Record the kind (`bug`, `feature`, `improvement`, `concept`) with
`lar-work update <work ID> --revision N --kind <kind>`, which stays local. Each
time you record it, run `lar-work kind-disagreement <work ID>` and settle its
`disagreement`. The ticket changes only on the user's yes.

- Null, or `kept` is true: nothing to ask.
- `accessProblem` is set: tell the user why the ticket can't change and continue.
  Item details keeps the notice.
- Otherwise ask per the [question guide](shared/questions.md) whether to update
  the ticket, naming both kinds (`ticketKind` null means the ticket has no kind),
  the labels and type in `swap`, and `note`. Offer "Update ticket to <kind>" and
  "Keep ticket as <ticketKind>", or "Leave ticket as is". Then, with a fresh
  revision from `lar-work read`, record the answer:
  - Yes: `lar-work change-kind <work ID> --revision N --kind <kind>`, and tell the
    user its `line`. When it fails, tell the user what its error says changed. The
    same command finishes the change.
  - No: `lar-work record-kind-answer <work ID> --revision N --answer keep --ticket-kind <ticketKind or none>`.

When the read fails, tell the user the ticket went unchecked and continue.

Anything the user adds or corrects is another open question. Then:

- **Bug**: first a **Diagnose subagent** with [diagnosing-bugs](diagnose-bug.md) returns the
  cause, the evidence and a failing test to write; its open questions join the
  list.
- **Open questions**: settle every one here by [Grilling with docs](grilling-with-docs.md), for bugs
  and features alike. A question of how something looks or feels gets a
  **Prototype** child task with [prototype](prototype-question.md), started per
  [Orchestration](shared/orchestration.md): two or three variants differing only on
  that question; a logic or state question gets an HTML page. It keeps its
  screenshots in its own context and returns each variant's start command (or
  HTML path), the worktree path, the branch, a preferred port and a short
  description. Show the variants as below, ask for the user's pick, and keep
  it and the branch for the brief's **Confirmed** and **Notes for the builder**.

- **Another repository changes** (its role says it serves or uses what this
  item changes, or the work needs a change there): route that part per
  [Other repositories](shared/issue-tracker/work-records.md#other-repositories),
  and keep shaping this repository's part while the user chooses. Name each
  proposed build or recorded Dependency in the brief's **Notes for the
  builder**. This item is a build only if its own repository changes.
- **No open questions**: write the brief.
- **Too big or unclear for one session**: [Concepts](concepts.md).
  Repository count never makes an item a concept.

