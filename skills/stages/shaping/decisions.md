# Decisions

Input: decision method, parent destination, current answers and affected parts.
Output: saved answer/domain drafts, reconciled briefs/blockers and updated map.

Read [Structure](shared/issue-tracker/structure.md),
[Completion](shared/issue-tracker/completion.md) and the
[domain-doc setting](shared/domain-docs-setting.md).

With domain docs ON, draft through [Domain modeling](shared/domain-docs.md).

Use only the named method: [Grilling with docs](grilling-with-docs.md),
[Prototype](prototype-question.md), [Research](research-question.md), or the
bounded pre-task. A task permits no ungated product implementation. Prototype
picks follow [Questions](shared/questions.md); save the pick and branch with
the answer. Read prior answers before asking again.
Run each heavy command (a whole test suite, a production build, a performance
measurement, or anything expected to take over about a minute) on its own as
`lar-work heavy -- <command>`. Top-level decision threads use the background,
or their tool's longest timeout where it has no background mode. Delegated
roles use the foreground with their tool's longest timeout, per
[Wait for delegated work](shared/orchestration.md#wait-for-delegated-work). Then, in this order, so completion reads it as complete:

Read siblings with `lar-work decision-answer ID`; use current text or the resolved
replacement. Within the approved destination, adjust proposed builds without asking.
If this answer supersedes another, use `supersede-answer` per
[Completion](shared/issue-tracker/completion.md) before saving the map.

1. Save the confirmed answer (`lar-work set-body <work ID> --revision N --body answer --file <file>`)
   and, with domain docs ON, the drafts it settled, or "none"
   (`--body domain-drafts`). With domain docs OFF, save "none" and create no drafts.
2. Turn fog that cleared into new decision records, through [Concepts](concepts.md). When part of
   the destination is fully decided, make a build record for it
   (`slice.sh <concept work ID> "<title>" <brief file> --kind build --repository <owner/repo> [--blocked-by <work ID>]...`) with a
   brief ([3. Brief](brief.md)) whose Domain docs copies the map entries that
   build needs. Create drafts Queued with body, parent and blockers. After saving the map,
   follow [Brief](brief.md), check code evidence, run Doubt and [Gate](gate.md)
   for each, then set Ready. Answers, prose dependencies and decision completion
   never approve briefs. Record ordering with `lar-work add-blocker`; use
   Dependencies for other teams.
3. Save the concept's map. Put only results needed to explain parts or
   relationships in Decisions so far; keep the full answer in the decision
   record. Copy its drafts into Domain docs and remove cleared fog. Save changed
   blockers and Dependencies in records, never map prose. Once no Fog is left, record it with
   `lar-work set-fog <concept work ID> --revision N --fog gone`.

Start each new research decision with [Research](research-question.md);
other decisions stay Queued for Start decision. After these changes, follow
[Reconcile group](shared/reconcile-group.md), including the saved map. A proposed build
stays Queued until [Brief](brief.md) and [Gate](gate.md) make it Ready.
Ask only for expanded scope, new decisions or changes to active builds. Changed
briefs need fresh Doubt and a gate; retain the last approved ticket Spec meanwhile.
Use `lar-work completion ID` and `lar-work refinement PARENT` and address their
reported reasons. Start eligibility belongs to [Start build](start-build.md).

Read [Completion](shared/issue-tracker/completion.md) for delivery;
load [Publication](shared/issue-tracker/publication.md) only for a publication question.
