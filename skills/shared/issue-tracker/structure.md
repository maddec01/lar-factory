# Structure

Retitle with `lar-work retitle ID --revision N --title X`; `title-history ID`
keeps old names and projection failures. Ticket titles queue under the existing
Spec setting and Access; never edit the tracker directly.

A concept or linked-work parent owns delivery parts. Create each part with
`bash <this skill>/shared/scripts/slice.sh <parent> "<title>" <body-file> --kind decision|build --repository <owner/repo> [--blocked-by <work>]...`.
It prints the work ID; keep it. This uses `lar-work create-part --parent ID
--revision N --title X --repository R --kind build|decision --file F
[--blocked-by ID]...`, where N is the parent's last-read revision. The named
repository, body, parent, blockers and Queued state are saved in one transaction.
Any failure saves nothing. Builds wait
for shaping and their gate before Ready. Ordinary standalone captures still start
in List. No later `set-parent` or Status write is needed to finish a new part.

Buildable work, including bugs, features, improvements and issues, owns private
slices. Call `slice.sh` without `--kind` or `--repository` for these: they stay in
the parent's repository and are private implementation records, not delivery parts.
Record a later blocker with `lar-work add-blocker <work ID> --revision N
--blocker <work ID>`, and drop one with `remove-blocker`. Self, cycle and
redundant edges are refused; read the implying path and keep only necessary
edges. `children`, `blockers` and `dependents` read the structure.

Set aside with `lar-work set-aside ID --revision N --file F`. F lists every
dependent `{workId,revision,action,reason}`; action is `remove`, `hold` or
`replace` (also `blockerId,blockerRevision`). Conflicting fields abort all writes.
Use `set-aside-history ID` for the retained reasons.

Merge proposed builds with `lar-work merge-build ID --revision N --file F`.
F is `{into,revisions:{ID:N},dependencyRevisions:{ID:N}}`: read the survivor,
parent, edge endpoints and held Dependencies first. It absorbs acceptance and
context, redirects blockers and requires a fresh gate; it never records a PR merge.

A decision's first `decision` body may start with `Method: task|grill|prototype|research`
to initialize its saved method. Later bodies preserve it; change it with
`lar-work update ID --revision N --decision-method task` (or `none` to clear).

After group changes, follow [Reconcile group](../reconcile-group.md).
