# Triage labels

Lar Factory keeps an item's state in its Status (see `docs/agents/issue-tracker.md`),
so a label says what an item is, never where it stands. Every repository has
these workflow labels:

| Label | Meaning |
| --- | --- |
| `bug` | Something broken |
| `feature` | New behaviour |
| `improvement` | Better existing behaviour |
| `concept` | A map of work needing decisions and builds |
| `decision-grill` | Concept decision settled by questions |
| `decision-prototype` | Concept decision settled by a prototype |
| `decision-research` | Concept decision settled by research |
| `decision-task` | Concept decision settled by a small task |
| `build` | Issue that becomes one PR |
| `active` | Slice an implementer is working on now |
| `blocked` | Slice an implementer couldn't finish, waiting for a re-slice |

An item's kind is one of `bug`, `feature`, `improvement` or `concept`. The
`labels` in `.lar-factory.json` list the repository's custom labels, which mark
the part of the product an item touches.

## Matt Pocock's triage roles

Bundled guidance in `lar-shape` and `lar-build` name triage roles. Each maps to this:

| Role | In Lar Factory |
| --- | --- |
| `needs-triage` | Status List |
| `needs-info` | Status Needs you, with a comment that says what is missing |
| `ready-for-agent` | Unused: threads start from the board, so the item keeps its Status and gets no label |
| `ready-for-human` | Status Needs you |
| `wontfix` | Close the issue as not planned: `gh issue close <number> --reason "not planned"` |
| `bug` | `bug` |
| `enhancement` | `feature` or `improvement`: `feature` for new behaviour, `improvement` for better existing behaviour |

Where a skill says to apply a state role, set the Status it maps to.
