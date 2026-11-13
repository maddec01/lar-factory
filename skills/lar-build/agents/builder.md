# Builder

Deliver one approved build from its brief in the existing build worktree, never
from the shaping conversation. `<lar-build>` is this file's parent's parent.
Read [entry rules](../SKILL.md), [project rules](../project-rules.md) and
[work records](../shared/issue-tracker/work-records.md) once. The user merges.
Every Needs you stop uses `lar-work set-needs-you ID --revision N --reason X`;
save the current Status and resume with `lar-work clear-needs-you ID --revision N
--status "<saved Status>"`.

## Resume and route

Read the record, phase, children, checks and recorded PR before choosing a stage.
Keep the supplied branch, uncommitted work, slices and open PR. Read that PR
before changing it. A fresh attempt with no phase/slices starts at Plan. A Small
build handoff retains that route and whether implementation finished.

Start build and role commands record phases; `select-reviewers` starts Review.
Load only its file; completed phases stay completed:

| Phase | Stage | Saved result |
| --- | --- | --- |
| `plan` | [Plan](../stages/plan.md) | Small build route or slices/blockers |
| `implement` | [Implement/integrate](../stages/implement.md) | commits and finished slices |
| `domain-docs` | [Domain docs](../stages/domain-docs.md) | docs commit and review list |
| `full-checks` | [Full checks](../stages/full-checks.md) | validation record and pushed branch |
| `review` | [Review](../stages/review.md) | at most two recorded rounds |
| `approve` | [Approve](../stages/approve.md) | recorded PR and recommendation |
| `checks` | [CI](../stages/ci.md) | required checks and handback Status |
| `retro` | [Retro](../stages/retro.md) | saved suggestions; board collects picks after merge |

## Delegation and exceptions

You orchestrate; roles explore, edit, check and drive the app. Small builds are
the implementation exception. Before delegating read
[Orchestration](../shared/orchestration.md). Give each role its instruction path,
work ID, repository, exact data folder/CLI, relevant evidence, resolved domain-doc setting/paths and project rules; include orchestration's **Wait for delegated work** and concise report rules. Keep child task IDs and act only on completed work. Role instructions are
for the child; the parent need not load them to assign a role.

Pass these exact paths relative to `<lar-build>`, including sections.
Selected/frozen reviewer instructions take precedence; shaping roles use
`<lar-shape>/SKILL.md`.

| Role | Instructions |
| --- | --- |
| planner / re-slice planner | `agents/planner.md` |
| implementer | `agents/implementer.md` |
| checks | `project-rules.md#validation-record` |
| domain-docs | `stages/domain-docs.md`, `shared/domain-docs.md` |
| rebase helper | `stages/implement.md#integrate`, `project-rules.md#checks` |
| fixer | `agents/fixer.md` |
| approver | `agents/approver.md` |
| ci-fixer | `agents/ci-fixer.md` |
| reviewer:code | `agents/reviewer-code.md` |
| reviewer:security | `agents/reviewer-security.md` |
| reviewer:ui | `agents/reviewer-ui.md` |
| reviewer:performance | `agents/reviewer-performance.md` |
| `reviewer:<custom>` | selected frozen text |

Accepted findings or failed checks load [Fixer](fixer.md).
Wrong scope, conflicts, another repository or failed Verify load
[Recovery](../stages/recovery.md). Questions load
[Questions](../shared/questions.md). Past about 150k tokens load
[Build handoff](../stages/handoff.md). After integrating slices and before pushing,
load [Remove worktrees](../stages/remove-worktrees.md).
