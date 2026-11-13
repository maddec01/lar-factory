# Work records

Factory work lives in work records on the user's machine. A record holds the
work's title, Status, structure, brief, map, decisions, threads and PR. Steps
read and write records only through `lar-work` and the shared scripts.
`lar-work --help` lists the commands; pass your last-read `--revision`. Unrelated changes reapply automatically; conflicts name the fields to reread and decide.

Work records are the source of truth for factory progress, including queue,
Status and build progress. Tickets hold created issues, gated Specs and the
historical structural projections. They are not a backup of local work records.

Stage-event contract (not implemented): `lar-work record-stage ID --revision N --file F` stores stage inputs, outputs and wait/resume evidence; use existing bodies and thread references until available.

## Picking

A **work ID** names one record for its whole life. Work reaches the board through local capture or from the repository List.
The configured GitHub issues or Azure DevOps team source supplies that List;
there is no per-ticket import step. A source-backed record keeps its ticket
reference and initial text
(`lar-work context <work ID>`). That text is where shaping starts. A ticket
already carrying Spec markers supplies its Original as initial context on a new
machine, without restoring a local brief. Once this machine syncs a Spec, the
ticket is the source of truth under [Ticket Specs](ticket-specs.md).

Resolve a thread's argument, a work ID or a ticket (`owner/repo#12`, its issue
URL, or an Azure work item URL), with
`bash <this skill>/shared/scripts/work.sh <ref>`, which prints the record. For
a ticket with no local record, use the repository List to add the work, then
resolve it again. A thread uses the existing local identity instead of creating
a duplicate record.

Name the work ID in every handoff, delegated-task brief and thread message.

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

The statuses are List, Queued, Shaping, Needs you, Ready, In progress, Review,
Verify, Ready to merge and Done. Move work with
`bash <this skill>/shared/scripts/status.sh <work ID> "<Status>"` as the
workflow directs. It writes only the record, then asks a running board to read
it. It refuses Done, which completion decides, and a PR, which has no Status.
Every wait on the user uses `lar-work set-needs-you ID --revision N --reason X`:
Status and reason change together. Save the current Status before waiting; resume
with `lar-work clear-needs-you ID --revision N --status "<saved Status>"`.
`status.sh ID "Needs you" --reason X` uses the same command; moving out of Needs
you through `status.sh` clears the reason in the same write.

## Load only for the current operation

- Creating a ticket: [Issue creation](issue-creation.md).
- Reading, gating or publishing a ticket-backed brief: [Ticket Specs](ticket-specs.md).
- Creating children or changing blockers: [Structure](structure.md).
- Another repository or a Dependency: [Other repositories](other-repositories.md).
- Checking refinement, delivery or blocker completion: [Completion](completion.md).
- Structural publication question: [Publication](publication.md).
- Delivering a PR: [PR delivery](publication-pr.md).
- Recovering a deleted thread: [Deleted threads](deleted-threads.md).

Factory structure stays local; Settings cannot resume structural publication.
Explicit issue creation and ordinary gated Specs remain available.

## Providers

A repository's provider is its origin's host. Read GitHub tickets with the
local `gh` login, and Azure DevOps work items per
[Azure DevOps](azure-devops.md#azure-devops). A failed read leaves the record
as it was.
