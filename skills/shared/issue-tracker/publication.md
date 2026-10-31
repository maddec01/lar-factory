# Tracker structure sync

The local tracker-sync option is ON by default during onboarding. It authorizes
saving concept and multi-repository structure, independently of building anything.
The app saves this option as `settings.structureSync`. The local-settings helper
also accepts `progressSync` as a compatibility spelling. Both mean structural
sync only. An explicit OFF in either spelling makes the helper report OFF.

Save edits to work records first. The structural outbox drains automatically when
the option is ON, with the board open or closed. Use
`lar-work sync-structure <work ID>` to request synchronization of that work's
structure explicitly. Read `lar-work --help` for its result and recovery details.
An OFF setting keeps the structure local. It never causes a later publish prompt.

## What reaches the tracker

Save only the information needed to understand which issues belong together:

- The concept or multi-repository kind, destination and constituent parts.
- The map diagram and relationships between those parts.
- Connections between repositories and Dependencies on other owners.
- Shaping results necessary to explain that structure.

Ordinary briefs, decision records, answers, domain drafts and slices stay local.
Queue position, board Status, workflow stage, phase, per-item progress, completion
styling and review state stay local too. A map projection must omit those fields
even when the local map contains them. Tracker sync is not a backup of work records.

The saved onboarding choice covers these structural updates. Do not offer a
second publication step or ask for permission again for each update. A refused
write leaves the local work intact; report the refusal and use the command's
recorded outcome for recovery. Do not retry an uncertain write blindly. Separate
requests to change another team's work still require the user's authorization.

## Restoring on another installation

Add the repository and use its List to add the saved concept or multi-repository
work. This restores kind, map, parts and relationships, including Connections and
Dependencies. Queue and Status start fresh. It restores no ordinary brief,
decision, slice or build-progress history. The user chooses what to shape or
build next.

## Dependency requests

Keep each Dependency's need, owner, contract and relationships in the local record.
Structural sync saves the relationship and the information needed to explain it.
Use an existing owning-team ticket when available. A new request to that team is
separate work authorized by the user; give them request text when no write is
authorized. A closed ticket does not mark a local Dependency met. Only the user's
`lar-work mark-met` does that.

## Delivery PRs

Read [PR delivery](publication-pr.md) when opening a build's PR. PR delivery uses
the build's own ticket when one exists and never requires a ticket for local work.
