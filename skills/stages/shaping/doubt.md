Ported from addyosmani/agent-skills (skills/doubt-driven-development); see UPSTREAM.md.

# Doubt

Disprove the exact `lar-work doubt-package <work ID>` against each repository,
never the shaping conversation. Follow supplied instructions; do not discover guidance. Do not search for repository guidance or config files
in checkouts, parents or home folders. Read named code and supplied domain-doc paths;
missing evidence is not approval.
Run `lar-work brief-scope-check <work ID>` first.
Use the exact repository/ref/revision evidence from [Explore](pick-up.md#explore),
reading code at those revisions rather than the project's working files. Missing
revision evidence needs Explore first; after a related merge, refresh the affected
repository and check the brief against it. Return the revisions checked in local
review evidence.

Normally run no suite, build, typecheck or lint. Run only the smallest command
needed to resolve a named uncertainty reading cannot settle. Follow the supplied
orchestration guide for heavy commands and completion.

Report only what would make the build wrong or unbuildable. Leave out mechanics
the builder can read from the code (files, functions, step order, tests, data
shapes), even when Notes for the builder omits them.

## Recheck

Given the earlier findings and the brief diff, run `brief-scope-check`, mark each
earlier finding fixed or unfixed, and check only the changed text against the
Full review. Report only what the change introduced, unfixed findings and any
scope-check mismatch. Without both inputs, run the full review.

## Full review

Check destination, current answers, siblings, contracts, blockers, Dependencies
and release constraints together. Challenge endpoint, hosting, redirect and CORS
assumptions against code in every affected repo. Check every category:
- Wrong: verify claims about code, contracts, ADRs, siblings, platform and
  current behaviour against files.
- Ambiguous: each Done when criterion has one observable interpretation.
- Inconsistent: criteria, statuses, steps, sibling contracts, decisions,
  blockers, Dependencies and release constraints agree, as does `brief-scope-check`.
- Decision: Confirmed, Done when or the code settles every product decision,
  including user-visible error, empty, slow, cancelled and permission behaviour,
  platforms and existing data.
- Defaults: Notes for the builder states storage and error defaults; a missing
  one gets a Fix with the simplest safe default and no unrequested UI.
- Repository: changes outside this repo belong to an authorized build there or
  the owning team's Dependency, named in Notes for the builder.
- Provider writes: reject progress in ticket bodies, comments, labels, tags or
  Azure State. Only issue creation and whole gated Specs with Original follow
  saved settings and verified Access; structural publication remains suspended.
- Domain docs: OFF requires no drafts and an omitted Domain docs section; accept
  legacy "none" sections. ON requires each used term to
  match existing language or be drafted with a canonical name, avoided synonyms
  and a one- or two-sentence project definition, without implementation details.
  ADRs state context, decision and reason and must be hard to reverse, surprising
  without context AND a real trade-off. Contradicting an existing ADR requires
  explicit supersession. Origin citations name published tickets or the build PR,
  never work IDs/local paths. When draft structure is uncertain, read only the
  [glossary](shared/glossary-format.md) or [ADR](shared/adr-format.md) format.

## Result

Tie findings to the supplied package revisions; write no drafts. End each with
`Fix:` when shaping can settle it from the brief, code or Confirmed, otherwise
`Decision:` with a question and recommended answer for Pedro.

```
earlier:
- <earlier finding>: fixed|unfixed (recheck only)
findings:
- [wrong|ambiguous|inconsistent|decision|defaults|repository|provider-writes|domain-docs] brief section: problem. Evidence: <path:line or quote>. Fix: <edit> | Decision: <question; recommended answer>
clean:
- <categories with no findings, or recheck>
not checked:
- <anything unverified and why>
```
