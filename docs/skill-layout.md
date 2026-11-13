# Skill source layout

Run `pnpm run assemble:skills`. Assembly replaces the ignored
`.assembled-skills/lar-shape` and `lar-build` folders, then packages both under
`.assembled-skills/skills` for the desktop installer.

Each bundle receives its workflow source, `skills/shared` at `shared/`, and
`skills/stages/shaping` at its root. Shaping stages have one source home, including
pick-up, size-up, brief, gate, decisions and Doubt. Assembly copies their bytes
without rewriting links and refuses a workflow-local name collision.

The two `SKILL.md` files route work. Load references only when their condition
is reached, not recursively. Each stage names its record inputs and outputs.
The record guide routes operation-specific reads; command help owns syntax.
Proposed commands are explicitly marked, never presented as available operations.
Group changes and observed delivery merges load `reconcile-group.md`; `lar-work
reconcile` owns its checklist, while the stage owns semantic repairs and re-gates.

| Thread or role      | Route                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Fresh shaping       | entry → pick-up → size-up → brief → gate                                    |
| Concept             | entry → pick-up → confirmed size-up → concepts; methods only as used        |
| Decision            | entry → pick-up → decisions → named method                                  |
| Gate-only           | entry common rules → gate; no exploration or size-up                        |
| Linked work         | owning route + other-repositories and reconcile-group                       |
| Build               | entry → agents/builder → recorded phase in stages/                          |
| Planner/implementer | own agent file, project rules, orchestration and slices as needed           |
| Each reviewer       | own agent file + review-result + only that role's Copies                    |
| Approver/CI fixer   | own agent file, project rules, validation and PR delivery when used         |
| Doubt               | canonical doubt stage, orchestration, prose and exact affected-work package |

Build phases live in `skills/lar-build/stages`: plan, implement/integrate,
domain-docs, full-checks, review, approve, ci and retro. Recovery, handoff and
worktree removal load on their own triggers. A Small build uses the implementation
stage directly; sliced builds assign planner/implementer instructions to children.
The parent passes role paths without loading child instructions. Retro runs only after the board confirms merge and Done; its suggestions wait
for board selection. Build-time scope
corrections use shared Brief, reconciliation and Gate, then resume the same build.

`skills/shared/issue-tracker/work-records.md` holds identity, revisions and Status;
separate operation files hold ticket creation, Specs, structure, other repositories,
completion and deleted-thread recovery. `domain-docs-setting.md` reads the local
setting; `domain-docs.md` loads when drafting/reviewing domain language. Prose loads
once; agent-document guidance loads when writing those documents. Questions,
orchestration and handoff load only when used.

Shared text is lar-owned or a Port listed in `UPSTREAM.md`. Edit these directly.
Review Copies live in `skills/lar-build/skills`, their checklists in `references`.
Update Copies through `skill-sync`. Overrides stay beside the loading step, cite
the Copy and heading, and appear in its `UPSTREAM.md` row. Copies and licences
assemble unchanged. Existing project conventions override fallback coding style.

Run `bash scripts/assemble-skills.test.sh` to verify provenance, collisions,
relative links and packaging. Shared and desktop installation tests exercise
updating installed bundles. Context measurements count cumulative file exposure
per route, not installed bundle size; moved paths must be mapped explicitly.
