Ported from mattpocock/skills (skills/engineering/domain-modeling/SKILL.md); see UPSTREAM.md.

# Domain modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `GLOSSARY.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Where domain docs live

`repo-config.sh <repository>` reads this machine's local `domainDocs` setting.
This setting controls drafting and file writes. `off` is OFF and `repository`
is ON. A saved `private` value reads as OFF, never as a private drafting mode.
No repository instructions or setup files are required.

`{"kind": "repository", "glossary": "GLOSSARY.md", "adrs": "docs/adr"}`
names the glossary file and ADR folder. Use the configured paths in place of the
examples below. Builds include the relevant entries and ADRs in their build PR.

`{"kind": "off"}` means write no domain drafts or glossary or ADR files. Read
existing domain docs for context and write "none" in the brief's or map's Domain
docs and a decision's domain-drafts body. Offer no later publication. When ON,
shaping drafts entries in work records, the whole gated brief includes them in
the ticket Spec when enabled, and the builder writes them in the build PR.
Shaping alone writes no repository files in either mode.

## File structure

Most repos have a single context:

```
/
├── GLOSSARY.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `GLOSSARY-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── GLOSSARY-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── GLOSSARY.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── GLOSSARY.md
│       └── docs/adr/
```

In repository mode, create files lazily during the build: only when you have something to write. If no `GLOSSARY.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `GLOSSARY.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Capture domain docs

When domain docs are ON, shaping, concept and decision threads draft each
resolved entry in the work record. Save a decision's domain drafts with
`lar-work set-body --body domain-drafts`, then include them in the brief's or
map's Domain docs. They leave the checkout as found. The builder writes those
drafts in the build PR. An entry or ADR that cites its origin names the published
ticket, or the build PR when there is none, never a work ID or local path.
Capture each term as it settles using [glossary-format.md](./glossary-format.md).
With domain docs OFF, keep Domain docs and domain-drafts as "none".

`GLOSSARY.md` should be totally devoid of implementation details. Do not treat `GLOSSARY.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Draft ADRs sparingly

Draft an ADR only when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [adr-format.md](./adr-format.md).
