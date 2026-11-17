# 2. Size up

Input: initial context and exploration. Output: confirmed understanding, Kind
and next route, kept together in the work record or thread until the brief is saved.


After reading the item and lightweight exploration, derive the expected outcome,
affected repositories, open decisions and next step from the submitted request
and available evidence. Keep the item's stated constraints using
`lar-work --help`'s scope schema; never invent requirements.

Open decisions are unresolved user-visible product behaviour, not routine
engineering edge cases. Choose the simplest safe default for storage failures,
error handling and similar mechanics; preserve the requested behaviour without
adding notices, warnings or recovery UI nobody requested. For optional name
storage, for example, keep greeting usable and simply do not remember the name
when storage fails. Write these defaults in the brief; do not ask the user to
design them or put them in `openDecisions`.

When the request names each repository's role in one outcome, include all those
parts without asking whether to shape them together or omit a repository.
For example, when one repository defines badge text and another displays it,
select linked work once product decisions are settled. Deriving that structure
from the request is not a scope change. If badge behavior is unresolved, ask
only about that behavior; do not bundle it with a structure confirmation.

When there are no open decisions and the proposed work follows the submitted
request, including its named repository roles, continue to diagnosis or brief drafting
without a "Confirm scope" question. Save the scope JSON with
`lar-work confirm-scope <work ID> --revision N --file <scope.json> --source submitted-request`.
The record keeps the submitted title and context as its source, with no invented
identity or reply. Present this understanding with the final brief; its Gate is
the one approval.

Ask through [Questions](shared/questions.md) only for unresolved product decisions,
conflicts, repository involvement left open by the request, or a proposed Kind or
structure change beyond that request. A connection or an engineering dependency
alone does not authorize adding another repository. Name the
actual choice and reuse prior answers and authorization. Wait for the needed
answer before dependent work; silence leaves that question pending in Needs you.
Save the settled understanding with
`lar-work confirm-scope <work ID> --revision N --file <scope.json> --identity <user> --evidence "<actual answer>"`.
An explicit amendment uses this same response path; do not ask for a second
confirmation of the answer.

Capture `repositories` and `openDecisions` in that scope, then run `lar-work choose-structure <work ID>` (which records Concept or Build) and follow its result: `single` keeps this flow; `linked` makes this item a parent without a brief: one `create-parts` batch per [Structure](shared/issue-tracker/structure.md) saves its map and one build per scope repository with dependency blockers, then this thread ends after [Reconcile group](shared/reconcile-group.md); `concept` records the open decisions as parts. Release and activation belong in the parent's release steps.

On resume, reuse `lar-work confirmed-scope <work ID>` when the understanding is
unchanged, whether its source is the submitted request or an explicit answer.
Keep its source and scope together for that comparison. Ask only about a
necessary amendment.


For linked work and concepts, record release or activation on the parent with `lar-work set-release-plan` and record its steps and Outcome check evidence through the release commands in `lar-work --help`; never create an activation task.

Apply explicit additions or corrections as amendments; ask only if they leave a
decision unresolved. Then:

- **Bug**: first a **Diagnose subagent** with [diagnosing-bugs](diagnose-bug.md) returns the
  cause, the evidence and a failing test to write; its open questions join the
  list. If exploration or diagnosis shows the reported symptom does not reproduce
  on the freshly fetched default revision, state the observed behavior briefly
  and ask one question through [Questions](shared/questions.md):
  **Close as already fixed (Recommended)** / **It still happens: tell me where**.
  Do not ask for a URL, revision, saved values or a reproduction checklist first.
  Wait for the answer. Close only on the user's choice; if it still happens,
  use where they report it to focus further diagnosis. Do not broaden the bug to
  a nearby behavior or draft a fix for an already-fixed symptom.
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
  [Other repositories](shared/issue-tracker/other-repositories.md).
  Include a part already authorized by the submitted request without another
  question. If the request leaves its involvement open, ask whether to include
  it; keep shaping independent work while that answer is pending. Adding an
  unrequested repository is an amendment: confirm the new `repositories`, rerun
  `choose-structure` and follow its result. Name each
  proposed build or recorded Dependency in the brief's **Notes for the
  builder**. This item is a build only if its own repository changes.
- **No open questions**: write the brief.
- **Too big or unclear for one session**: [Concepts](concepts.md).
  Keep the command's cross-repository structure choice; size alone does not turn settled linked work into a concept.
