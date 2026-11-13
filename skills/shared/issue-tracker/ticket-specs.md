# Ticket Specs

For ticket-backed ordinary builds, a passing gate queues the whole brief as
Spec when the saved setting is ON, preserving prior text as Original. Concepts,
decisions, slices and Dependencies do not use this path. Never publish progress
or structure through it.

When approval is needed, follow [Gate](../../gate.md) for refresh, review
and board-only approval.
Changed text needs fresh review and approval; agent gate writes refuse.

Failed writes stay pending with Retry in details and do not block Ready. Report
the error without claiming publication. Inspect warnings when tracker text
replaces a pending Spec; the displaced text remains in gate history. Title-only
edits preserve the pending Spec. Trusted tracker edits sync without changing
Status; unknown/unverified GitHub editors remain held. Details Save approves
exactly that Spec. Before first Spec sync, or with writing OFF, ticket edits do
not replace local briefs. Removing active Spec markers makes the whole body Spec.

Start build refreshes the ticket and checks its gate; later edits leave the
running build's snapshot unchanged. The command/outbox owns provider revisions,
Original preservation, HTML conversion and retry identity. Use it rather than
reimplementing tracker writes.
