# Structure

Retitle with `lar-work retitle ID --revision N --title X`; `title-history ID`
keeps old names and projection failures. Ticket titles queue under the existing
Spec setting and Access; never edit the tracker directly.

A concept or linked-work parent owns delivery parts. For group growth, use
`lar-work create-parts PARENT --revision N --file F` once, not a per-part loop.
F supplies `{map,parts:[{key,title,repository,kind,body,blockerIds,ticketRequestId?}]}`;
`$key` names a new blocker and `${key}` in text inserts its work ID. Ticket UUID
requests, all records, map and blockers commit together. Provider failures retain
requests: retry `sync-part-tickets PARENT`. Ordinary captures stay in List;
new parts are Queued for shaping, changed drafts are Shaping until their gate.

Declare `Blocked by:` with backtick unique work titles or `none` in each brief.
Keep work IDs in local map declarations. Settings supply build ticket requests.
`lar-work sync-blockers PARENT --file F` derives the graph; F is
`{revisions:{ID:N}}` for the parent, declared members and edge endpoints.
Declare shared contract ownership with `Produces:` and consuming work with `Consumes:`
(backtick contract names and work titles). `Contracts:` names used contracts.
`sync-blockers` also derives cited output prerequisites; ambiguous sources hold.
An independent consumer records ``No ordering needed: `reference`: reason`` in its brief.
Normalize legacy declarations; never edit delivery edges by hand. Use Dependencies for other teams.

Private implementation slices use `slice.sh` without `--kind` or `--repository`;
they stay in their build's repository and never become delivery parts.

Set aside with `lar-work set-aside ID --revision N --file F`. F lists every
dependent `{workId,revision,action,reason}`; action is `remove`, `hold` or
`replace` (also `blockerId,blockerRevision`). Conflicting fields abort all writes.
Unanswered decisions naming the candidate prevent retirement; `set-aside-history ID` retains reasons.

Merge proposed builds with `lar-work merge-build ID --revision N --file F`.
F is `{into,revisions:{ID:N},dependencyRevisions:{ID:N}}`: read the survivor,
parent, edge endpoints and held Dependencies first. It absorbs acceptance and
context, redirects blockers and requires a fresh gate; it never records a PR merge.

A decision's first `decision` body may start with `Method: task|grill|prototype|research`
to initialize its saved method. Later bodies preserve it; change it with
`lar-work update ID --revision N --decision-method task` (or `none` to clear).

After group changes, follow [Reconcile group](../reconcile-group.md).
