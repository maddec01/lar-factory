# Capture-only concepts

Follow [Retro capture](../retro-capture.md) for selection and routing. A
selected suggestion spanning repositories becomes one concept record in the
source work's repository, even when the source build and checkout are in another
repository.

Capture makes only the concept record, with
`lar-work create --kind concept --status List` in the source work's repository and
its map, with the selection ID, as initial context:
the sections in [Concepts](../../concepts.md), the affected repositories in
Destination, and the decomposition left in Fog. Decisions, builds and blockers
come later in shaping. A reused concept keeps its Status.

The saved tracker-sync option applies to this concept's structure only. Capture
adds no queue, Status or ordinary progress to the tracker.
