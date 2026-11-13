# Structural publication suspended

Keep concept maps, decomposition, attachment relationships, cross-repository
Connections and Dependencies in local work records. Legacy structural publication
is suspended. Settings cannot restore it, and `lar-work sync-structure` reports
the suspension without writing to a tracker. Exploration and attachment do not
authorize structural writes. No replacement sharing arrangement is available.

Pending outbox entries and recovery data remain local and retained. Preserve
uncertain creation identities and conflicts; do not retry with a new identity or
use confirmed-missing recovery to bypass the suspension.

## Access

Explicit issue creation and ordinary non-concept Ticket Specs still follow
[work records](issue-creation.md), including verified Access,
duplicate protection and the Azure read-only setting. Repository names,
Connections and historical consent grant no write permission.

## Historical recovery

Existing committed structural snapshots may still supply kind, map, parts and
relationships when saved work is added from List. Restored items start in List
with no queue. Historical snapshots contain no ordinary brief, decision, slice
or build-progress history. Recovery is limited to previously saved data;
suspended publication creates no new snapshot. Preserve conflicting versions
and pending local changes. There is no conflict resolution UI or automatic merge.

## Dependency requests

Keep each Dependency's need, owner, contract and relationships local. Use an
existing owning-team ticket when available. A new request to that team requires
the user's authorization; otherwise provide request text. A closed ticket does
not mark a Dependency met. Only the user's `lar-work mark-met` does that.

## Delivery PRs

Read [PR delivery](publication-pr.md) when opening a build's PR. PR delivery uses
the build's own ticket when one exists and never requires a ticket for local work.
