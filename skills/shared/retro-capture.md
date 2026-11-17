# Retro capture

The board owns follow-up selection and creation. Supply all suggestions to
`propose-retro` in the build's Retro stage, at its first handback and before
the delivery PR merges; save `[]` when there are none. Each suggestion has
`{title,description,repository,kind}`, where kind is `bug`, `feature` or
`improvement` and repository is the onboarded owner of its code, instructions,
CI or tooling. Resolve an unknown destination before proposing.

The desk's **Choose follow-ups** card records picks before the delivery PR
merges and makes chosen List records/tickets under each destination's retro
setting and verified Access. The merge drops suggestions nobody chose. A failed
creation shows as a board toast and is never retried; never create those
records/tickets yourself. Picks authorize later shaping, not implementation. No
chat selection or agent-authored approval substitutes for the board action.
