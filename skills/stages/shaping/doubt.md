Ported from addyosmani/agent-skills (skills/doubt-driven-development); see UPSTREAM.md.

# Doubt

Disprove the exact `lar-work doubt-package <work ID>` against each repository,
never the shaping conversation. Follow supplied instructions; do not discover guidance. Do not search for repository guidance or config files
in checkouts, parents or home folders. Read named code and supplied domain-doc paths;
missing evidence is not approval.
Run `lar-work brief-scope-check <work ID>` first; missing confirmation or drift
is an incomplete finding. Check destination, current answers, siblings/overlaps,
files/contracts, blockers, Dependencies and release constraints together. Challenge
endpoint, hosting, redirect and CORS assumptions against code in every affected repo.

Normally run no suite, build, typecheck or lint. Run only the smallest command
needed to resolve a named uncertainty reading cannot settle. Follow the supplied
orchestration guide for heavy commands and completion.

Check every category:
- Wrong: verify claims about code, platform and current behavior against files.
- Ambiguous: each Done when criterion has one observable interpretation.
- Inconsistent: criteria, statuses and steps agree, including sibling contracts,
  current decisions, blockers, Dependencies and release constraints.
- Incomplete: cover error, empty, slow, cancelled and permission states; every
  affected platform; migrations, deployment, existing data and choices otherwise
  left to the builder.
- Assumption: every relied-on assumption appears in Confirmed.
- Repository: changes outside this repo belong to an authorized build there or
  the owning team's Dependency, named in Notes for the builder.
- Provider writes: reject progress in ticket bodies, comments, labels, tags or
  Azure State. Only issue creation and whole gated Specs with Original follow
  saved settings and verified Access; structural publication remains suspended.
- Domain docs: OFF requires "none" and no drafts. ON requires each used term to
  match existing language or be drafted with a canonical name, avoided synonyms
  and a one- or two-sentence project definition, without implementation details.
  ADRs state context, decision and reason and must be hard to reverse, surprising
  without context AND a real trade-off. Contradicting an existing ADR requires
  explicit supersession. Origin citations name published tickets or the build PR,
  never work IDs/local paths. When draft structure is uncertain, read only the
  [glossary](shared/glossary-format.md) or [ADR](shared/adr-format.md) format.

Return findings tied to the supplied brief/package revisions for the owner's
gate evidence. Write no drafts. Name every category a thorough pass found clean.

```
findings:
- [wrong|ambiguous|inconsistent|incomplete|assumption|repository|provider-writes|domain-docs] brief section: problem. Evidence: <path:line or quote>. Fix: <suggestion>
clean:
- <categories with no findings>
not checked:
- <anything unverified and why>
```
