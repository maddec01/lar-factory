# Work tracking

The board tracks work saved on this machine and in a repository's issue tracker.

## Language

**Abandon**:
Setting work aside on this machine. Closing its linked tracker ticket is a separate, optional action.
_Avoid_: delete work.

**Spec**:
The refined brief as it appears as a ticket's main description after shaping.
_Avoid_: refined ticket.

**Original**:
The text a ticket had before its first Spec, kept collapsed in the ticket.
_Avoid_: initial ticket.


**Slice**:
A private part of a build that is completed when its work merges into the build branch. Slices appear within their build and are not separate board items.
_Avoid_: sub-ticket.

**Active slice**:
An unfinished, unblocked slice whose implementation thread or its live descendants are currently running. An unavailable activity observation cannot establish that a slice is active.
_Avoid_: In progress slice.
