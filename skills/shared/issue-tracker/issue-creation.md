# Issue creation

Use saved Add item, retro and Spec defaults and verified Access. Names,
Connections and old consent lists grant no permission. Refused/unchecked access
requires Recheck access in Settings. `LAR_FACTORY_AZURE_READ_ONLY=1` bars Azure
writes. Unverified fine-grained GitHub tokens require a classic token or gh OAuth;
editing others' issues also requires push access.

`lar-work create` saves local work only. To attach a new ticket while keeping
its identity, use `create-ticket ID --revision N --request-id UUID`. The command
applies kind mappings and chooses description or the whole passing Spec with
Original under the saved setting. Use `--retro` for the separate retro default,
per [Retro capture](../retro-capture.md). Explicit Create issue and Attach a
ticket remain available regardless of Add item's default.

Keep failed captures local. An uncertain create must recover with the same
request ID, never a new ID to bypass uncertainty. Follow the error if Azure
strips the recovery marker. If the ticket exists but its local save failed,
use the ticket named in the error with Find a ticket. The board owns form
options, mapping defaults, write-access checks and source display; no agent
recreates them. Suspended structural publication creates no labels.
