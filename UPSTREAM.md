# Upstream

Every copied skill and every ported file, where it came from, an upstream commit
and that commit's date. `skill-sync` compares each one with upstream from this
commit and updates this file when you take or skip changes.

A Copy, in the Copies table, is never edited by hand, and its commit means
"matches this commit". Factory rules live in `lar-shape` and `lar-build`.
Existing project instructions supply project conventions. To set aside part of a Copy, lar writes an Override in its
own skill, citing the Copy's file and section heading, and lists it here.

"Overridden in" lists the Copy's Overrides: lar rules, in lar's own skills, that
replace or set aside part of the Copy. Each entry is `<copy file>#<heading> (<lar file>)`,
with the copy file relative to the Copy's folder (or the file name, for a Copy that
is one file), and `; ` separates entries. An entry without `#<heading>` cites the file
itself, for an Override of text under no heading, such as a preamble. `skill-sync`'s
`upstream-changes.sh` reads it and flags each Override an upstream change touches.

A Port, in the Ports table, is a lar file rewritten from upstream skill text,
which lar edits freely. Its first line names its source and points here. Port is
the file's repository path. Path lists the upstream skill folders it draws from.
Sections lists each `<path from the source's root>#<heading>` it folds in; a
file with no `#heading` means the whole file. `; ` separates entries in both.
A Port's commit means "upstream reviewed up to here": it moves forward when the
Maintainer ports an upstream change or skips it.

| Skill | Source | Path | Repository path | Commit | Date | Overridden in |
| ----- | ------ | ---- | --------------- | ------ | ---- | ------------- |
| `code-review` | mattpocock/skills | `skills/engineering/code-review` | `skills/lar-build/skills/code-review` | `5beb35b040e3` | 2026-10-19 | SKILL.md (skills/lar-build/agents/reviewer-code.md); SKILL.md#1. Pin the fixed point (skills/lar-build/agents/reviewer-code.md); SKILL.md#2. Identify the spec source (skills/lar-build/agents/reviewer-code.md); SKILL.md#3. Identify the standards sources (skills/lar-build/agents/reviewer-code.md); SKILL.md#4. Spawn both sub-agents in parallel (skills/lar-build/agents/reviewer-code.md); SKILL.md#5. Aggregate (skills/lar-build/agents/reviewer-code.md) |
| `security-and-hardening` | addyosmani/agent-skills | `skills/security-and-hardening` | `skills/lar-build/skills/security-and-hardening` | `aeac41d4d005` | 2026-10-13 | SKILL.md#Process: Threat Model First (skills/lar-build/agents/reviewer-security.md); SKILL.md#Ask First (Requires Human Approval) (skills/lar-build/agents/reviewer-security.md); SKILL.md#Verification (skills/lar-build/agents/reviewer-security.md) |
| `frontend-ui-engineering` | addyosmani/agent-skills | `skills/frontend-ui-engineering` | `skills/lar-build/skills/frontend-ui-engineering` | `aeac41d4d005` | 2026-10-13 | SKILL.md#Red Flags (skills/lar-build/agents/reviewer-ui.md); SKILL.md#Verification (skills/lar-build/agents/reviewer-ui.md) |
| `references/security-checklist.md` | addyosmani/agent-skills | `references/security-checklist.md` | `skills/lar-build/references/security-checklist.md` | `aeac41d4d005` | 2026-10-13 |  |
| `references/performance-checklist.md` | addyosmani/agent-skills | `references/performance-checklist.md` | `skills/lar-build/references/performance-checklist.md` | `aeac41d4d005` | 2026-10-13 | performance-checklist.md#TTFB Diagnosis (skills/lar-build/agents/reviewer-performance.md); performance-checklist.md#Common Anti-Patterns (skills/lar-build/agents/reviewer-performance.md); performance-checklist.md#Measurement Commands (skills/lar-build/agents/reviewer-performance.md) |
| `references/accessibility-checklist.md` | addyosmani/agent-skills | `references/accessibility-checklist.md` | `skills/lar-build/references/accessibility-checklist.md` | `aeac41d4d005` | 2026-10-13 | accessibility-checklist.md#Common Anti-Patterns (skills/lar-build/agents/reviewer-ui.md) |

| Port | Source | Path | Sections | Commit | Date |
| ---- | ------ | ---- | -------- | ------ | ---- |
| `skills/shared/write-prose.md` | cursor/plugins | `pstack/skills/unslop` | pstack/skills/unslop/SKILL.md | `8b3326d99fd4` | 2026-10-22 |
| `skills/shared/handoff-content.md` | mattpocock/skills | `skills/productivity/handoff` | skills/productivity/handoff/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/glossary-format.md` | mattpocock/skills | `skills/engineering/domain-modeling` | skills/engineering/domain-modeling/GLOSSARY-FORMAT.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/domain-docs.md` | mattpocock/skills | `skills/engineering/domain-modeling` | skills/engineering/domain-modeling/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/adr-format.md` | mattpocock/skills | `skills/engineering/domain-modeling` | skills/engineering/domain-modeling/ADR-FORMAT.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/skill-mechanics.md` | mattpocock/skills | `skills/productivity/writing-for-agents` | skills/productivity/writing-for-agents/SKILL-MECHANICS.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/write-agent-docs.md` | mattpocock/skills | `skills/productivity/writing-for-agents` | skills/productivity/writing-for-agents/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/agents/doubt.md` | addyosmani/agent-skills | `skills/doubt-driven-development` | skills/doubt-driven-development/SKILL.md#Step 3: DOUBT — Invoke the fresh-context reviewer | `aeac41d4d005` | 2026-10-13 |
| `skills/lar-shape/agents/doubt.md` | addyosmani/agent-skills | `skills/doubt-driven-development` | skills/doubt-driven-development/SKILL.md#Step 3: DOUBT — Invoke the fresh-context reviewer | `aeac41d4d005` | 2026-10-13 |
| `skills/lar-shape/grill.md` | mattpocock/skills | `skills/productivity/grilling` | skills/productivity/grilling/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-shape/prototype-logic.md` | mattpocock/skills | `skills/engineering/prototype` | skills/engineering/prototype/LOGIC.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-shape/prototype-ui.md` | mattpocock/skills | `skills/engineering/prototype` | skills/engineering/prototype/UI.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-shape/prototype-question.md` | mattpocock/skills | `skills/engineering/prototype` | skills/engineering/prototype/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-shape/research-question.md` | mattpocock/skills | `skills/engineering/research` | skills/engineering/research/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-shape/diagnose-bug.md` | mattpocock/skills | `skills/engineering/diagnosing-bugs` | skills/engineering/diagnosing-bugs/SKILL.md#Redact; skills/engineering/diagnosing-bugs/SKILL.md#Phase 1: Build a feedback loop; skills/engineering/diagnosing-bugs/SKILL.md#Phase 2: Reproduce + minimise; skills/engineering/diagnosing-bugs/SKILL.md#Phase 3: Hypothesise; skills/engineering/diagnosing-bugs/SKILL.md#Phase 4: Instrument | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/grill.md` | mattpocock/skills | `skills/productivity/grilling` | skills/productivity/grilling/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/prototype-logic.md` | mattpocock/skills | `skills/engineering/prototype` | skills/engineering/prototype/LOGIC.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/prototype-ui.md` | mattpocock/skills | `skills/engineering/prototype` | skills/engineering/prototype/UI.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/prototype-question.md` | mattpocock/skills | `skills/engineering/prototype` | skills/engineering/prototype/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/research-question.md` | mattpocock/skills | `skills/engineering/research` | skills/engineering/research/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/diagnose-bug.md` | mattpocock/skills | `skills/engineering/diagnosing-bugs` | skills/engineering/diagnosing-bugs/SKILL.md#Redact; skills/engineering/diagnosing-bugs/SKILL.md#Phase 1: Build a feedback loop; skills/engineering/diagnosing-bugs/SKILL.md#Phase 2: Reproduce + minimise; skills/engineering/diagnosing-bugs/SKILL.md#Phase 3: Hypothesise; skills/engineering/diagnosing-bugs/SKILL.md#Phase 4: Instrument | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/plan-slices.md` | mattpocock/skills | `skills/engineering/to-tickets` | skills/engineering/to-tickets/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/implement-slice.md` | mattpocock/skills | `skills/engineering/implement` | skills/engineering/implement/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/test-first-mocking.md` | mattpocock/skills | `skills/engineering/tdd` | skills/engineering/tdd/mocking.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/test-first-tests.md` | mattpocock/skills | `skills/engineering/tdd` | skills/engineering/tdd/tests.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/test-first.md` | mattpocock/skills | `skills/engineering/tdd` | skills/engineering/tdd/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/compare-module-designs.md` | mattpocock/skills | `skills/engineering/codebase-design` | skills/engineering/codebase-design/DESIGN-IT-TWICE.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/design-modules.md` | mattpocock/skills | `skills/engineering/codebase-design` | skills/engineering/codebase-design/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/deepen-module.md` | mattpocock/skills | `skills/engineering/codebase-design` | skills/engineering/codebase-design/DEEPENING.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/write-pr.md` | mattpocock/skills | `skills/engineering/pr` | skills/engineering/pr/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/review-session.md` | mattpocock/skills | `skills/engineering/retro` | skills/engineering/retro/SKILL.md | `5beb35b040e3` | 2026-10-19 |

Full commits: mattpocock/skills `5beb35b040e3de97e54fa9e386d7e42d15c295c2`, addyosmani/agent-skills `aeac41d4d005999432bb7312f7ff06383a91d59d`, cursor/plugins `8b3326d99fd4b993cb33a24dad8af03175c642c5`.

Checked up to: mattpocock/skills `5beb35b040e3`, addyosmani/agent-skills `aeac41d4d005`, cursor/plugins `8b3326d99fd4`.

Authors: mattpocock/skills by Matt Pocock (MIT), addyosmani/agent-skills by Addy Osmani (MIT), cursor/plugins by Lauren Tan (MIT).

The Authors line names each source's author and licence, which the board app's
Settings > Skills shows on each Copy's row.

Review Copies resolve their relative checklist links inside `skills/lar-build`.
