# Work records

Factory work lives in work records on the user's machine. A record holds the
work's title, Status, structure, brief, map, decisions, threads and PR. Steps
read and write records only through `lar-work` and the shared scripts.
`lar-work --help` lists the commands and what each prints. Every change takes
the `--revision` from your last read; when the record moved on, the change
writes nothing, so read it again and redo the change.

Work records are the source of truth for factory progress, including queue,
Status and build progress. Tickets hold created issues, gated Specs and the
separate structural projection. They are not a backup of local work records.

## Picking

A **work ID** names one record for its whole life. Work reaches the board through local capture or from the repository List.
The configured GitHub issues or Azure DevOps team source supplies that List;
there is no per-ticket import step. A source-backed record keeps its ticket
reference and initial text
(`lar-work context <work ID>`). That text is where shaping starts. A ticket
already carrying Spec markers supplies its Original as initial context on a new
machine, without restoring a local brief. Once this machine syncs a Spec, the
ticket is the source of truth under [Ticket Specs](#ticket-specs).

Resolve a thread's argument, a work ID or a ticket (`owner/repo#12`, its issue
URL, or an Azure work item URL), with
`bash <this skill>/shared/scripts/work.sh <ref>`, which prints the record. For
a ticket with no local record, use the repository List to add the work, then
resolve it again. A thread uses the existing local identity instead of creating
a duplicate record.

Name the work ID in every handoff, delegated-task brief and thread message.

## Issue creation

Onboarding and Settings offer Create issues from Add item, Create issues from
retro captures and Write the refined spec to the issue. Each defaults to ON,
including for existing repositories. Verified Access controls each write.
Refused or unchecked Create issues disables the first two options and the Add
item checkbox; refused or unchecked Edit issues disables the Spec option.
`LAR_FACTORY_AZURE_READ_ONLY=1` bars Azure writes. Repository, organization and
project names grant no permission. A stored consent list grants none either.
Recheck access in Settings. Unverified fine-grained GitHub tokens need a classic
token or gh OAuth login; editing other people's issues also needs push access.

Add item starts its Create issue checkbox from the selected repository's default.
The checkbox changes only that submission. With it on, GitHub offers labels,
assignee and milestone, plus issue type for organization repositories. Azure
offers work item type, tags, assignee and iteration, using the team's default
area. Only title, repository and kind are required. All options start empty
except the kind's mapped labels and type. Fields without write Access are hidden
and their mapped values are omitted. Unreadable options leave title and description
usable; Azure still needs a readable team backlog type or creation fails.

Vocabulary mapping is optional in onboarding and Settings. It maps bug, feature
and improvement to existing labels and type, suggests same-name labels and allows
none. A typed label is created only when saved. Skipping this step creates no
labels. Structure sync separately creates `linked-work`, as onboarding explains.

A successful submission creates a ticket and a List record whose initial context
is the submitted description. An unticked checkbox saves local work. Failure
keeps the Add item draft open and adds nothing to List. An uncertain create blocks
resubmission: its durable request ID and hidden ticket marker recover an existing
result, including after a restart. Never retry with a new ID to bypass uncertainty.
If Azure strips the marker, follow the error and check the board. When the ticket
exists but saving its record failed, use the ticket named in the error with Find
a ticket.

A ticketless item's details offer Create issue beside Attach a ticket, regardless
of the Add item default. It previews the stored title and outgoing text without
text editing and keeps the work ID. Without a current passing brief, or with Spec
writing off, it sends the description. Otherwise it sends the whole passing brief
as Spec with the description as Original. Access still applies.
`lar-work create-ticket <work ID> --revision N --request-id <UUID>` uses the same
path with kind mappings. [Retro capture](../retro-capture.md) uses `--retro` and
the separate retro default, keeping failed captures local for later conversion.
`lar-work create` alone creates no ticket.

Every card, row and item details shows its source, using the GitHub or Azure mark
for tickets and a laptop for local work. Conversion updates that source.

## Ticket Specs

When a ticket-backed ordinary record passes its gate and Write the refined spec
to the issue is ON, the whole brief becomes the ticket's main description, the
Spec. The ticket's prior text remains in a collapsed Original section. This
covers other people's tickets in onboarded repositories too. Concept maps,
decisions, slices and Dependency tickets never use this write path. Structural
sync has its own setting and protocol.

From the first synced Spec, the ticket is the source of truth. The record keeps
a copy for gate evidence and the builder. `lar-work gate <work ID>` rereads the
ticket before returning its digest and sync status. Read the brief and revision
after that refresh, before reviewing or gating the text. `record-gate` rereads
again and rejects stale revisions or digests. A held GitHub edit needs Accept or
Reject in item details before a later gate.

A durable outbox survives closing the board. A failed Spec write keeps the item
Ready and shows an error and retry in details. Report the failure without
claiming the ticket was updated. The saved GitHub digest or Azure revision
distinguishes the old ticket from a real edit, so an unchanged ticket cannot
replace an unsent gated brief. When the ticket's main text also changes while a
write is pending, the ticket wins. The record warns that it replaced the unsent
Spec and keeps that text in gate history. Title-only changes keep the pending
Spec. Gate history records tracker and conflict provenance.

Board ticket reads import trusted Spec and title edits without changing Status.
Azure converts HTML back to Markdown only for an actual text edit. GitHub edits
by someone without verified repository write access, or with an unknown editor,
stay held in details for the user's Accept or Reject. Azure member edits sync
without this check. Never use held text as build instructions before acceptance.
Saving the description in details approves that exact Spec, updates the local
copy and queues its ticket write. Ready stays Ready.

GitHub rereads the issue's own body immediately before writing. It has no
conditional body edit, so a small race after that read remains. Azure tests the
work-item revision and preserves its managed structure block and Original HTML.
Azure Bugs use Repro Steps, leaving a separate Description intact. Azure writes
HTML and includes a visible `Original (Lar Factory)` heading as a fallback when
sanitizers remove comments or details. Fake-provider tests cover both markup
forms; they do not prove a live deployment's sanitizer behavior.

Start build rereads the ticket and starts from its text. If reading fails, it
uses the record's last copy and reports the warning. Later edits update the
record and leave an already running build as it started. Details show Spec as
the main description and Original collapsed. A ticket without factory markers
keeps its ordinary display; removing markers from an active Spec makes the whole
description count as Spec. Before the first Spec, or with its setting OFF,
ticket edits do not replace local briefs.

## Status

The statuses are List, Queued, Shaping, Needs you, Ready, In progress, Review,
Verify, Ready to merge and Done. Move work with
`bash <this skill>/shared/scripts/status.sh <work ID> "<Status>"` as the
workflow directs. It writes only the record, then asks a running board to read
it. It refuses Done, which completion decides, and a PR, which has no Status.

## Structure

A concept owns decisions and builds. Buildable work owns slices, including bugs,
features, improvements and issues. Create owned work
with
`bash <this skill>/shared/scripts/slice.sh <parent> "<title>" <body-file> [--kind decision|build] [--blocked-by <work>]...`.
It prints the new work ID; keep it. Under a concept, `--kind` names a decision
or a build; under a build the record is a slice. Record a later blocker with
`lar-work add-blocker <work ID> --revision N --blocker <work ID>`, and drop one
with `remove-blocker`. `children`, `blockers` and `dependents` read the
structure.

Owned work takes its parent's repository unless it is a build in another
repository, as [Other repositories](#other-repositories) routes it.

## Other repositories

Route each part of the work that another repository needs by that repository.
`bash <this skill>/shared/scripts/repo-config.sh --list` lists the onboarded
repositories, and `repo-config.sh --connections <owner/repo>` prints the ones
connected to this one.

- An onboarded repository is one the user can change. A Connection grants no
  permission to act. When the work needs a change in a connected onboarded
  repository, describe the required part and shape it within the user's authorized scope.
  Ask only when it adds scope the user has not authorized. Make it with
  `lar-work create --title X --repository <owner/repo> --kind build`, put it
  under the concept with `lar-work set-parent` or record the wait with
  `lar-work add-blocker`, and shape it in that repository. An onboarded
  repository that isn't connected comes into play only when the user names it.
- In a repository that is not onboarded, read code, docs and tickets for
  context and write nothing there. When required work is there, keep refining
  and offer the user both choices: add it to shape its part, or record a
  Dependency for the team that owns it. Onboard or change a repository only on
  the user's choice.
- When the login cannot push a branch or deliver a fork PR to a repository,
  explain the block to the user and offer a Dependency.

Record a Dependency on the work that needs it with
`lar-work add-dependency <work ID> --file <file>`. The JSON's `need` says what
is needed and why, and `owner` names the owning repository or team;
`lar-work --help` lists the optional fields. It prints the Dependency ID. Hold
each build that waits on it with
`lar-work add-dependency-block <Dependency ID> --revision N --build <work ID>`.
Send its request to the owning team per
[Dependency requests](publication.md#dependency-requests).

A Dependency is met only when the user marks it met
(`lar-work mark-met <Dependency ID> --revision N --identity <user>`). A closed
ticket proves neither deployment nor the contract. After the handover, read
that team's ticket and PRs to follow the work, and leave the ticket as the team
keeps it: never edit, assign, move or close it.

Onboarding the repository later keeps its Dependencies. Replacing one with a
build is the user's choice and needs their approval of the plan. Once they
approve, make the build as above and run
`lar-work replace-dependency <Dependency ID> --revision N --build <work ID>`.

## Completion

Completion comes from the records. `lar-work completion <work ID>` prints
whether work is complete and why not; `lar-work waiting-on <work ID>` prints its
blockers that aren't complete. A build is complete once its recorded PR merges.
A decision is complete once its answer and domain drafts are recorded and its
concept's map is written after them. A concept is complete once its Fog is
recorded gone (`lar-work set-fog`) and every decision and build it owns is
complete. A Status, a closed ticket or an ended thread completes nothing, and no
step changes Azure State to record local completion. A delivery PR uses the
provider's closing relationship independently of local completion.

## Tracker structure sync

Follow [Tracker structure sync](publication.md) for concepts and multi-repository
work. The ON-by-default local `structureSync` option saves kind, map diagram,
parts, Connections, Dependencies and issue grouping, with only the shaping
results needed to explain them. Local changes enter the structural outbox
automatically.
`lar-work sync-structure <work ID>` requests a drain explicitly. Queue, Status,
decision records, slices and per-item progress stay local. Whole gated briefs
use [Ticket Specs](#ticket-specs), independently of structure sync.
Shaping and starting a build remain independent choices.

On a new machine, add the repository, then add its saved work from List to
reconstruct the structure and cross-repository links. Restored items start in
List. Structural recovery restores no ordinary brief, decision record, slice or
progress history. A ticket Spec preserves its text, but adding it on another
machine restores no local brief or gate history. Conflicting structural versions
stop sync with both copies retained. Follow the protocol's recovery rules rather
than assuming a merge or conflict resolution UI exists.

Opening a build's PR follows [PR delivery](publication-pr.md), including
work without a ticket.

## Providers

A repository's provider is its origin's host. Read GitHub tickets with the
local `gh` login, and Azure DevOps work items per
[Azure DevOps](azure-devops.md#azure-devops). A failed read leaves the record
as it was.
