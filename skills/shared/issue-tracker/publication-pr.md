# Delivery PR relationships

Read the build's current work record, `last-published` and
`publication-attachment`. A ticket may come from publication of its concept
without being attached to the build yet. Use this build's own ticket, including
a picked ticket. Its concept's parent ticket is never its closing target.

Write the complete PR outcome, decisions and reasons from the private brief
inside the repository's template. Save the Markdown body to a file and run
`lar-work publication-pr-body <work ID> --file <body file>`. Its JSON `body`
preserves that content and adds `Closes <owner/repo#n>` for GitHub. Include
the closing line even when the repository defines no ticket-link style, and
retain its other PR requirements and attribution. Ticketless work keeps the
complete body and needs no ticket. A project rule demanding a missing ticket
is a Clash per `project-rules.md`.

Open the PR through the provider, then record its reference immediately with
`lar-work set-pr <work ID> --revision N --pr <repository#n>`. If PR creation
loses its response, inspect existing PRs by branch before creating another.
Use `lar-work prepare-publication-pr <work ID>` to obtain the delivery plan.
It returns `null` for ticketless work. GitHub verifies the closing reference
already in the reviewed body and requires the default branch as target.
Azure previews the native PR work-item relationship. It preserves the team's
PR completion options, including whether linked work items transition when
the user merges. The factory never writes Azure State or enables completion
behavior on the user's behalf.

Inspect with `lar-work inspect-publication-pr <work ID> --plan <plan ID>`.
Show the exact PR, ticket and operation, and ask for approval before an
outstanding link write. Record the approved digest with `approve-publication`
as in [publication](publication.md#preview-and-approval). Then run
`lar-work execute-publication-pr <work ID> --plan <plan ID> --identity <executor>`.
Azure needs separate `relate-ticket` consent. The command records its claim
before linking and its successful, failed or uncertain outcome afterward.
It leaves native completion settings as they are. Repeating execute resumes
only pending work, and checks an existing native link before any add.

After a lost response, run
`lar-work reconcile-publication-pr <work ID> --plan <plan ID> --identity <approver>`.
A confirmed relationship resolves to success. Missing, ambiguous or refused
evidence stays uncertain. Ask the user to resolve it using inspected evidence
through `resolve-publication-outcome` before any retry. After refusal, ask
before preparing a new plan with `prepare-publication-pr`; inspect and approve
its new digest. Changed sources, settings, PR or ticket also need a new plan.
Use the shared journal's outcome and evidence commands for manual recovery;
keep successful relationships and never repeat an uncertain add.

If a native link is refused, show the refusal and ask before any separately
prepared comment fallback through the publication workflow. A textual
reference cannot promise provider closure. Report that limitation and keep
the recorded PR as the authority for the build's local completion. The user
merges every PR.
