# Ticket Specs

When a ticket-backed ordinary record passes its gate and Write the refined spec
to the issue is ON, the whole brief becomes the ticket's main description, the
Spec. The ticket's prior text remains in a collapsed Original section. This
covers other people's tickets in onboarded repositories too. Concept maps,
decisions, slices and Dependency tickets never use this write path. Legacy structural publication is suspended.

From the first synced Spec, the ticket is the source of truth. The record keeps
a copy for gate evidence and the builder. `lar-work gate <work ID>` rereads the
ticket before returning its digest and sync status. Read the brief and revision
after that refresh, before reviewing or gating the text. `record-gate` rereads
again and requires the reviewed brief digest. A held GitHub edit needs Accept or
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

