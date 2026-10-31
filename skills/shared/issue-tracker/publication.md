# Tracker structure sync

The local tracker-sync option is ON by default during onboarding. It authorizes
saving concept and multi-repository structure, independently of building anything.
The app saves this local option as `settings.structureSync`. The app and
local-settings helper use only `structureSync`; an explicit `false` turns it OFF.

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

## Access

Onboarding verifies GitHub issue creation, comments and labeling before it enables
structural sync. Verification checks the logged-in classic token's actual scopes
and the repository role together. An unverified fine-grained token blocks the
option. Tell the user to grant repository Issues read and write permission and
check access again; do not treat an unverified permission as authorization.

Azure needs verified work-item creation, description editing and comments.
The configured team's backlog determines the issue type and default area for new
parts. Saved access applies to later structural updates. Recheck a refused
capability in repository settings instead of repeatedly requesting each write.

## Storage and conflicts

Version 1 stores a structural snapshot for a connected component of ownership
and blocker relationships. Its canonical root prefers parentless concepts and
breaks ties by durable identity, falling back to other parentless parts. Each
issue's managed projection links to that root's committed manifest. Parts in
other repositories carry explicit repository identities as well as issue URLs.

GitHub never patches authored issue bodies. It appends immutable managed
projection and manifest comments, and immutable gzip/base64 chunk comments.
The `linked-work` label enables cheap discovery before reading comments. When
structure is first used, the writer creates this label only if it is absent.
It never changes an existing label's name, color or description, or replaces an
issue's other labels. It reads comment pages backwards from the latest page and
reuses ETags, so ordinary discussion cannot hide older structural metadata.

Azure reads numeric work items through the batch resource. It patches only the
managed description block through the numeric REST endpoint, with a JSON Patch
test of `/rev`. Authored description bytes outside the block remain intact.
Chunk comments use Markdown format. Neither transport writes queue, Status or
workflow progress.

The writer stores gzip/base64 chunks before committing the root manifest. It
checks SHA-256 digests for the chunks and complete snapshot when reading. An
interrupted save cannot restore a partial map. Child projections resolve the
root's latest committed snapshot. Large maps remain in chunks rather than
exceeding description limits.

After a detach or split, each resulting connected component gets its canonical
root. A part that no longer belongs to concept or multi-repository structure
retires its old snapshot pointer with identity-only metadata. Cleanup checks the
last saved identity and digest before writing. Old immutable comments remain as
history, and the latest managed metadata determines current membership.

A root manifest names its preceding digest. Concurrent forks or a changed remote
digest stop sync and retain both copies, including pending local changes. There
is no conflict resolution UI or automatic merge yet. Report the conflict and
preserve the versions for reconciliation before an explicit retry.

For an uncertain issue creation, the writer looks for its durable identity before
retrying. If it cannot confirm creation, it stops. Only after verifying that no
issue was created, retry with
`lar-work sync-structure <work ID> --confirmed-missing-issue <identity>`.

## Restoring on another installation

Add the repository and use its List to add the saved concept or multi-repository
work. This restores kind, map, parts and relationships, including Connections and
Dependencies. Restored items start in List with an empty queue. It restores no
ordinary brief, decision, slice or build-progress history. The user chooses what
to shape or build next.

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
