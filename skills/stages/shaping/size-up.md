# 2. Size up

Input: initial context and exploration. Output: confirmed understanding, Kind
and next route, kept together in the work record or thread until the brief is saved.


After reading the item and lightweight exploration, present the expected
outcome, affected repositories, open questions or "none", and proposed next
step in plain words. Ask the user to confirm or amend this understanding through
[Questions](shared/questions.md). Wait for explicit confirmation before diagnosis,
grilling, prototypes or brief drafting, even for a fully specified issue.
Incorporate amendments and present the revised understanding for confirmation.
Silence leaves the checkpoint pending in Needs you.
Show the item's stated constraints using `lar-work --help`'s scope schema. On confirmation, save that JSON with `lar-work confirm-scope <work ID> --revision N --file <scope.json> --identity <user> --evidence "<explicit response>"`; reuse `lar-work confirmed-scope <work ID>` on resume, and change it only after an explicit amendment.

Capture `repositories` and `openDecisions` in that scope, then run `lar-work choose-structure <work ID>` (which records Concept or Build) and follow its result: `single` keeps this flow; `linked` keeps one parent and creates one build per repository with dependency blockers; `concept` records the open decisions as parts. Release and activation belong in the parent's release steps.

On resume, reuse an explicit confirmation recorded in the thread or the brief's
Confirmed section only when the proposed understanding is unchanged. Keep the
confirmed understanding and the user's answer together for that comparison.
Otherwise ask again.


For linked work and concepts, record release or activation on the parent with `lar-work set-release-plan` and record its steps and Outcome check evidence through the release commands in `lar-work --help`; never create an activation task.

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

- **Another repository changes, after following `choose-structure`** (its role says it serves or uses what this
  item changes, or the work needs a change there): route that part per
  [Other repositories](shared/issue-tracker/other-repositories.md),
  and keep shaping this repository's part while the user chooses. Name each
  proposed build or recorded Dependency in the brief's **Notes for the
  builder**. This item is a build only if its own repository changes.
- **No open questions**: write the brief.
- **Too big or unclear for one session**: [Concepts](concepts.md).
  Keep the command's cross-repository structure choice; size alone does not turn settled linked work into a concept.
