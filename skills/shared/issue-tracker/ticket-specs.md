# Ticket Specs

For ticket-backed ordinary builds, a passing gate queues the brief’s team-facing prose as
Spec when the saved setting is ON, preserving nonempty authored prior text as Original. Empty Original blocks and
temporary creation markers are omitted. Creation keeps its marker until the
ticket number is saved locally, so an uncertain create can be recovered without
creating another issue. Concepts,
decisions, slices and Dependencies do not use this path. Never publish progress
or structure through it.

When approval is needed, follow [Gate](../../gate.md) for refresh, review
and board-only approval.
Changed brief text needs fresh review and approval; agent gate writes refuse.
Producer-only contract changes still need fresh compatibility review. Unchanged consumer inputs
retain their approval after that review passes.

Failed writes stay pending with Retry in details and do not block Ready. Report
the error without claiming publication. Inspect warnings when tracker text
replaces a pending Spec; the displaced text remains in gate history. Title-only
edits preserve the pending Spec. Linked-work declarations remain parseable in the local brief and are omitted
from the Spec. Tracker prose edits retain those local declarations.
Published Specs omit Size and keep Notes for the builder when it has team-facing content.
Trusted tracker edits sync without changing
Status; unknown/unverified GitHub editors remain held. Details Save approves
exactly that Spec. Before first Spec sync, or with writing OFF, ticket edits do
not replace local briefs. Removing active Spec markers makes the whole body Spec.

Start build refreshes the ticket and checks its gate; later edits leave the
running build's snapshot unchanged. The command/outbox owns provider revisions,
Original preservation, HTML conversion and retry identity. Use it rather than
reimplementing tracker writes.
