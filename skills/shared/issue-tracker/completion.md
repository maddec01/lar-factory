# Completion

Completion comes from the records. `lar-work completion <work ID>` prints
whether work is complete and why not; `lar-work waiting-on <work ID>` prints its
blockers that aren't complete. A build is complete once its recorded PR merges.
Read `lar-work decision-answer ID` for current text or its resolved replacement;
`answer-history ID` is historical. `set-body --body answer` versions each answer.
When a decision or gate replaces an answer, run
`lar-work supersede-answer ID --revision N --file F`: F is
`{answerRevision,by:{kind,workId,revision,answerRevision?|gateId?},affected:[{workId,revision}]}`.
It retains old text, links the replacement and invalidates affected gates atomically.
Save the map after reconciliation to incorporate exact answer versions and references.
A decision completes with its domain drafts and current incorporation.
After group answer changes or observed PR merges, follow [Reconcile group](../reconcile-group.md).
Concept delivery is complete once its Fog is recorded gone (`lar-work set-fog`)
and every decision and build it owns is complete. A Status, a closed ticket or an ended thread completes nothing, and no
step changes Azure State to record local completion. A delivery PR uses the
provider's closing relationship independently of local completion.

An unfinished concept with zero active builds reports `No delivery planned.`
Refinement alone neither starts retention nor releases blockers. Previously
finished concepts preserve their finished history.

`lar-work refinement <work ID>` separately checks a concept's nonempty map,
Fog recorded gone and settled active decisions. Its reasons identify an empty
map, remaining Fog or an unsettled decision. Set-aside decisions do not count.
Proposed builds need not pass gates or merge for refinement. The board displays
refinement and delivery separately; shaping consults refinement.
