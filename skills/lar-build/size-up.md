# 2. Size up


Pick the route from the issue, code and existing project conventions. State what
you understood, the repositories involved, open questions and the next shaping
step in plain words. Continue within the user's request without asking them to
approve the route. Ask only for missing decisions or an expansion of scope.
Any issue can be shaped independently. Ready means refinement passed its gate;
it commits the user to no build and starts no implementation.

Record the kind (`bug`, `feature`, `improvement`, `concept`) with
`lar-work update <work ID> --revision N --kind <kind>`. Anything the user adds
or corrects is another open question. Then:

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

