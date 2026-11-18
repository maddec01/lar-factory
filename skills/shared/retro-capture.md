# Retro capture

The board owns follow-up selection and creation. Supply all suggestions to
`propose-retro` in the build's Retro stage, at its first handback and before
the delivery PR merges; save `[]` when there are none after checking the sources.
Scope deferred in the Spec or source ticket, including its **Original** text
("for now", "later", "only X", "not yet"), becomes a suggestion by default.
This includes **Excluded** items those words refer to. Omit deferred work only
when already delivered or tracked, or explicitly a permanent non-goal; name the
omitted scope and cite that evidence in the handback. Being outside this delivery
is not a reason to discard it. There is no suggestion quota.

Each suggestion has
`{title,description,repository,kind}`, where kind is `bug`, `feature` or
`improvement` and repository is the onboarded owner of its code, instructions,
CI or tooling. Use the build's repository for product follow-ups it owns. If a
destination cannot be established from the available evidence, omit that candidate
and report why; never pause delivery to ask for routing.

The desk's optional **Choose follow-ups** card stays available after the delivery
PR merges, until the user picks or dismisses it. It makes chosen List records/tickets
under each destination's retro setting and verified Access. Neither an unanswered
pick nor follow-up creation holds delivery or a build slot. A failed
creation shows as a board toast and is never retried; never create those
records/tickets yourself. Picks authorize later shaping, not implementation. No
chat selection or agent-authored approval substitutes for the board action.
