# Issue creation

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
labels. Suspended structural publication creates no labels.

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

