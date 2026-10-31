# Work records

Factory work lives in work records on the user's machine. A record holds the
work's title, Status, structure, brief, map, decisions, threads and PR. Steps
read and write records only through `lar-work` and the shared scripts.
`lar-work --help` lists the commands and what each prints. Every change takes
the `--revision` from your last read; when the record moved on, the change
writes nothing, so read it again and redo the change.

Factory progress stays on this machine. No step edits a ticket's body,
comments, labels, tags or Azure State to record shaping, Status, structure or
build progress.

## Picking

A **work ID** names one record for its whole life. Work reaches the board when
the user captures it there or picks a ticket there: a GitHub issue, or an Azure
DevOps work item. A picked ticket's record keeps the ticket reference, and the
ticket's text at pick time is the record's initial context
(`lar-work context <work ID>`). That text is where shaping starts. Refinement in
the record is the authority, and a later ticket edit never changes it.

Resolve a thread's argument, a work ID or a ticket (`owner/repo#12`, its issue
URL, or an Azure work item URL), with
`bash <this skill>/shared/scripts/work.sh <ref>`, which prints the record. For
a ticket no record holds, it fails with "Pick the ticket on the board, then
rerun". Pass that on to the user and stop. Records come from the board's
capture and pick, so a thread never creates one for a ticket.

Name the work ID in every handoff, delegated-task brief and thread message.

## Status

The statuses are List, Queued, Shaping, Needs you, Ready, In progress, Review,
Verify, Ready to merge and Done. Move work with
`bash <this skill>/shared/scripts/status.sh <work ID> "<Status>"` as the
workflow directs. It writes only the record, then asks a running board to read
it. It refuses Done, which completion decides, and a PR, which has no Status.

## Structure

A concept owns decisions and builds, and a build owns slices. Create owned work
with
`bash <this skill>/shared/scripts/slice.sh <parent> "<title>" <body-file> [--kind decision|build] [--blocked-by <work>]...`.
It prints the new work ID; keep it. Under a concept, `--kind` names a decision
or a build; under a build the record is a slice. Record a later blocker with
`lar-work add-blocker <work ID> --revision N --blocker <work ID>`, and drop one
with `remove-blocker`. `children`, `blockers` and `dependents` read the
structure.

Owned work takes its parent's repository. Work that another repository needs
waits for Connections, which a later Lar Factory release adds. Tell the user
that cross-repository planning needs Connections, note the other repository's
part as out of scope in the map's Out of scope or the brief's Notes for the
builder, and suggest capturing it on that repository's board.

## Completion

Completion comes from the records. `lar-work completion <work ID>` prints
whether work is complete and why not; `lar-work waiting-on <work ID>` prints its
blockers that aren't complete. A build is complete once its recorded PR merges.
A decision is complete once its answer and domain drafts are recorded and its
concept's map is written after them. A concept is complete once its Fog is
recorded gone (`lar-work set-fog`) and every decision and build it owns is
complete. A Status, a closed ticket or an ended thread completes nothing, and no
step closes a ticket.

## Publication

Publishing work as tickets arrives in a later Lar Factory release. Until then
no step creates a ticket, and slices and decisions are never published. If the
user asks to publish, say it isn't available yet and keep the work in its
record.

## Providers

A repository's provider is its origin's host. Read GitHub tickets with the
local `gh` login, and Azure DevOps work items per
[Azure DevOps](azure-devops.md#azure-devops). A failed read leaves the record
as it was.
