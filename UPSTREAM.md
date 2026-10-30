# Upstream

Every copied skill and every ported file, where it came from, an upstream commit
and that commit's date. `skill-sync` compares each one with upstream from this
commit and updates this file when you take or skip changes.

A Copy, in the Copies table, is never edited by hand, and its commit means
"matches this commit". lar rules live in `lar-shape`, `lar-build` and in each
repo's `AGENTS.md`. To set aside part of a Copy, lar writes an Override in its
own skill, citing the Copy's file and section heading, and lists it here.

"Overridden in" lists the Copy's Overrides: lar rules, in lar's own skills, that
replace or set aside part of the Copy. Each entry is `<copy file>#<heading> (<lar file>)`,
with the copy file relative to the Copy's folder (or the file name, for a Copy that
is one file), and `; ` separates entries. `skill-sync`'s `upstream-changes.sh` reads
it and flags each Override an upstream change touches.

A Port, in the Ports table, is a lar file rewritten from upstream skill text,
which lar edits freely. Its first line names its source and points here. Port is
the file's repository path. Path lists the upstream skill folders it draws from.
Sections lists each `<path from the source's root>#<heading>` it folds in; a
file with no `#heading` means the whole file. `; ` separates entries in both.
A Port's commit means "upstream reviewed up to here": it moves forward when the
Maintainer ports an upstream change or skips it.

| Skill | Source | Path | Repository path | Commit | Date | Overridden in |
| ----- | ------ | ---- | --------------- | ------ | ---- | ------------- |
| `grilling` | mattpocock/skills | `skills/productivity/grilling` | `skills/lar-shape/skills/grilling` | `5beb35b040e3` | 2026-10-19 |  |
| `prototype` | mattpocock/skills | `skills/engineering/prototype` | `skills/lar-shape/skills/prototype` | `5beb35b040e3` | 2026-10-19 | LOGIC.md#3. Build the shareable HTML file (skills/lar-shape/size-up.md); LOGIC.md#4. Hand it over (skills/lar-shape/size-up.md); LOGIC.md#Anti-patterns (skills/lar-shape/size-up.md); UI.md#5. Hand it over (skills/lar-shape/size-up.md); SKILL.md#Rules that apply to both (skills/lar-shape/size-up.md) |
| `research` | mattpocock/skills | `skills/engineering/research` | `skills/lar-shape/skills/research` | `5beb35b040e3` | 2026-10-19 |  |
| `diagnosing-bugs` | mattpocock/skills | `skills/engineering/diagnosing-bugs` | `skills/lar-shape/skills/diagnosing-bugs` | `5beb35b040e3` | 2026-10-19 |  |
| `tdd` | mattpocock/skills | `skills/engineering/tdd` | `skills/lar-build/skills/tdd` | `5beb35b040e3` | 2026-10-19 |  |
| `code-review` | mattpocock/skills | `skills/engineering/code-review` | `skills/lar-build/skills/code-review` | `5beb35b040e3` | 2026-10-19 |  |
| `codebase-design` | mattpocock/skills | `skills/engineering/codebase-design` | `skills/lar-build/skills/codebase-design` | `5beb35b040e3` | 2026-10-19 |  |
| `pr` | mattpocock/skills | `skills/engineering/pr` | `skills/lar-build/skills/pr` | `5beb35b040e3` | 2026-10-19 |  |
| `retro` | mattpocock/skills | `skills/engineering/retro` | `skills/lar-build/skills/retro` | `5beb35b040e3` | 2026-10-19 |  |
| `to-tickets` | mattpocock/skills | `skills/engineering/to-tickets` | `skills/lar-build/skills/to-tickets` | `5beb35b040e3` | 2026-10-19 | SKILL.md#4. Quiz the user (skills/lar-build/agents/planner.md); SKILL.md#5. Publish the tickets to the configured tracker (skills/lar-build/agents/planner.md); SKILL.md#Blocked by (skills/lar-build/agents/planner.md) |
| `implement` | mattpocock/skills | `skills/engineering/implement` | `skills/lar-build/skills/implement` | `5beb35b040e3` | 2026-10-19 |  |
| `security-and-hardening` | addyosmani/agent-skills | `skills/security-and-hardening` | `skills/lar-build/skills/security-and-hardening` | `aeac41d4d005` | 2026-10-13 |  |
| `frontend-ui-engineering` | addyosmani/agent-skills | `skills/frontend-ui-engineering` | `skills/lar-build/skills/frontend-ui-engineering` | `aeac41d4d005` | 2026-10-13 |  |
| `references/security-checklist.md` | addyosmani/agent-skills | `references/security-checklist.md` | `skills/lar-build/references/security-checklist.md` | `aeac41d4d005` | 2026-10-13 |  |
| `references/performance-checklist.md` | addyosmani/agent-skills | `references/performance-checklist.md` | `skills/lar-build/references/performance-checklist.md` | `aeac41d4d005` | 2026-10-13 |  |
| `references/accessibility-checklist.md` | addyosmani/agent-skills | `references/accessibility-checklist.md` | `skills/lar-build/references/accessibility-checklist.md` | `aeac41d4d005` | 2026-10-13 |  |

| Port | Source | Path | Sections | Commit | Date |
| ---- | ------ | ---- | -------- | ------ | ---- |
| `skills/shared/write-prose.md` | cursor/plugins | `pstack/skills/unslop` | pstack/skills/unslop/SKILL.md | `8b3326d99fd4` | 2026-10-22 |
| `skills/shared/handoff-content.md` | mattpocock/skills | `skills/productivity/handoff` | skills/productivity/handoff/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/glossary-format.md` | mattpocock/skills | `skills/engineering/domain-modeling` | skills/engineering/domain-modeling/GLOSSARY-FORMAT.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/domain-docs.md` | mattpocock/skills | `skills/engineering/domain-modeling` | skills/engineering/domain-modeling/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/adr-format.md` | mattpocock/skills | `skills/engineering/domain-modeling` | skills/engineering/domain-modeling/ADR-FORMAT.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/skill-mechanics.md` | mattpocock/skills | `skills/productivity/writing-for-agents` | skills/productivity/writing-for-agents/SKILL-MECHANICS.md | `5beb35b040e3` | 2026-10-19 |
| `skills/shared/write-agent-docs.md` | mattpocock/skills | `skills/productivity/writing-for-agents` | skills/productivity/writing-for-agents/SKILL.md | `5beb35b040e3` | 2026-10-19 |
| `skills/lar-build/agents/reviewer-code.md` | addyosmani/agent-skills | `skills/code-review-and-quality` | skills/code-review-and-quality/SKILL.md#Step 2: Review the Tests First; skills/code-review-and-quality/SKILL.md#1. Correctness; skills/code-review-and-quality/SKILL.md#2. Readability & Simplicity; skills/code-review-and-quality/SKILL.md#3. Architecture; skills/code-review-and-quality/SKILL.md#5. Performance; skills/code-review-and-quality/SKILL.md#Structural Remedies; skills/code-review-and-quality/SKILL.md#Step 4: Categorize Findings | `aeac41d4d005` | 2026-10-13 |
| `skills/lar-build/agents/reviewer-security.md` | addyosmani/agent-skills | `skills/code-review-and-quality; skills/security-and-hardening` | skills/code-review-and-quality/SKILL.md#4. Security; skills/security-and-hardening/SKILL.md#Authentication and sessions; skills/security-and-hardening/SKILL.md#Rate limiting; skills/security-and-hardening/SKILL.md#Injection, XSS, and access control; skills/security-and-hardening/SKILL.md#Input validation and uploads; skills/security-and-hardening/SKILL.md#Destructive operations on derived paths; skills/security-and-hardening/SKILL.md#Secrets; skills/security-and-hardening/SKILL.md#Headers, CORS, and responses; skills/security-and-hardening/SKILL.md#Server-side fetches (SSRF); skills/security-and-hardening/SKILL.md#Dependencies and supply chain | `aeac41d4d005` | 2026-10-13 |
| `skills/lar-build/agents/doubt.md` | addyosmani/agent-skills | `skills/doubt-driven-development` | skills/doubt-driven-development/SKILL.md#Step 3: DOUBT — Invoke the fresh-context reviewer | `aeac41d4d005` | 2026-10-13 |
| `skills/lar-shape/agents/doubt.md` | addyosmani/agent-skills | `skills/doubt-driven-development` | skills/doubt-driven-development/SKILL.md#Step 3: DOUBT — Invoke the fresh-context reviewer | `aeac41d4d005` | 2026-10-13 |

Full commits: mattpocock/skills `5beb35b040e3de97e54fa9e386d7e42d15c295c2`, addyosmani/agent-skills `aeac41d4d005999432bb7312f7ff06383a91d59d`, cursor/plugins `8b3326d99fd4b993cb33a24dad8af03175c642c5`.

Checked up to: mattpocock/skills `5beb35b040e3`, addyosmani/agent-skills `aeac41d4d005`, cursor/plugins `8b3326d99fd4`.

Authors: mattpocock/skills by Matt Pocock (MIT), addyosmani/agent-skills by Addy Osmani (MIT), cursor/plugins by Lauren Tan (MIT).

The Authors line names each source's author and licence, which the board app's
Settings > Skills shows on each Copy's row.

Review Copies resolve their relative checklist links inside `skills/lar-build`.
