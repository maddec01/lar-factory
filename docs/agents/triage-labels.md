# Triage labels

Lar Factory keeps an item's kind and Status in its work record (see
`docs/agents/issue-tracker.md`). The repository needs no factory labels, and
publication uses only approved mappings to the team's types and labels.
A kind is one of `bug`, `feature`,
`improvement` or `concept`. Optional Repository config (`.lar-factory.json`)
lists the repository's custom `labels`, which mark the part of the product an
item touches.

## Matt Pocock's triage roles

Bundled guidance in `lar-shape` and `lar-build` names triage roles. Each maps
to this:

| Role | In Lar Factory |
| --- | --- |
| `needs-triage` | Status List |
| `needs-info` | Status Needs you, asking the user for what is missing |
| `ready-for-agent` | Unused: threads start from the board, so the item keeps its Status |
| `ready-for-human` | Status Needs you |
| `wontfix` | Abandon the work on the board, which keeps its record; closing the issue waits for the user's OK |
| `bug` | Kind `bug` |
| `enhancement` | Kind `feature` for new behaviour, or `improvement` for better existing behaviour |

Where a skill says to apply a role, record what it maps to. Status moves only
through the lar skill's `shared/scripts/status.sh`.
