# Work records

Read/write factory progress only through `lar-work` and shared scripts in the
supplied installation/data folder. Use command help for syntax and result fields.
Pass your last-read revision. Unrelated changes reapply automatically; conflicts
name fields to reread and reconsider. Records own queue, Status, structure,
bodies, threads and delivery. Tickets hold issues, gated Specs and historical
structure, not a backup of local progress.

Stage-event contract is unavailable: `record-stage ID --revision N --file F`.
Keep stage inputs, outputs and wait/resume evidence in bodies/thread references
until implemented.

## Picking

Resolve a work ID or GitHub/Azure ticket reference with
`bash <this skill>/shared/scripts/work.sh <ref>`. Reuse that identity throughout
handoffs, delegated briefs and thread messages. If missing, use the repository List to add the ticket
and resolve again; never create a duplicate. Read starting text with `context`.
A marked ticket's Original supplies initial context on a new machine, not a
restored local brief. After first Spec sync, follow [Ticket Specs](ticket-specs.md).

## Thread ownership

The board and factory handoffs share the same thread history. Before an
authorized top-level shaping or build handoff, read `lar-work threads <work ID>`
and `lar-work intents --unresolved`. Reuse an existing thread for that stage
while it or its children are active, queued or waiting for the user; when its
state cannot be checked, keep its ownership and report the uncertainty.

Before asking T3 to launch, save
`lar-work record-intent <work ID> --revision N --purpose shape|build`. Keep its
intent ID. Start the first message with `/lar-shape <work ID>` for shaping or
`Build <work ID>.` for a build. Once T3 returns its thread ID, reread the record
revision and run
`lar-work resolve-intent <work ID> --revision N --intent <intent ID> --thread <T3 thread ID>`.
This registers the owner durably and moves Queued to Shaping or Ready to In
progress, just as the board's Start does. A confirmed failed launch resolves
with `--failure <reason>` instead. An uncertain launch keeps its intent; recover
the original result rather than launching again. Never use a new intent to
bypass an unresolved launch. Delegated reviewers and implementers keep their
own role purposes, rather than claiming the parent's shaping or build stage.

## Status

Use `bash <this skill>/shared/scripts/status.sh ID "<Status>"` as directed by
the reached stage; it refreshes the board. Completion owns Done. A PR has no
workflow Status. Never write factory progress to tracker fields or comments.
Every wait uses `lar-work set-needs-you ID --revision N --reason X` to save reason
and Needs you Status together. Save the current Status; resume atomically with
`lar-work clear-needs-you ID --revision N --status "<saved Status>"`.
`status.sh ID "Needs you" --reason X` uses the same command; moving out clears
the reason in the same write.

## Operations

Load only for the operation being performed:
- Ticket creation: [Issue creation](issue-creation.md).
- Ticket brief refresh/gate/publication: [Ticket Specs](ticket-specs.md).
- Children/blockers: [Structure](structure.md).
- Other repositories/Dependencies: [Other repositories](other-repositories.md).
- Refinement/delivery/blocker completion: [Completion](completion.md).
- Structural publication question: [Publication](publication.md).
- PR delivery: [PR delivery](publication-pr.md).
- Deleted-thread recovery: [Deleted threads](deleted-threads.md).

Structure stays local; Settings cannot resume its publication. Issue creation
and ordinary gated Specs remain available. Determine provider from origin host:
GitHub uses local `gh` login, Azure follows [Azure DevOps](azure-devops.md).
A failed provider read preserves the record.
