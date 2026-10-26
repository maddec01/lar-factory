# Upstream

Every copied skill, where it came from, the upstream commit it matches and that
commit's date. `skill-sync` compares each copy with upstream from this commit
and updates this file when you take changes. Copies are never edited by hand; lar rules live in
`lar-work` and in each repo's `AGENTS.md`. To set aside part of a Copy, lar writes an
Override in its own skill, citing the Copy's file and section heading, and lists it here.

"Overridden in" lists the Copy's Overrides: lar rules, in lar's own skills, that
replace or set aside part of the Copy. Each entry is `<copy file>#<heading> (<lar file>)`,
with the copy file relative to the Copy's folder (or the file name, for a Copy that
is one file), and `; ` separates entries. `skill-sync`'s `override-changes.sh` reads
it and flags each Override an upstream change touches.

| Skill | Source | Path | Commit | Date | Overridden in |
| ----- | ------ | ---- | ------ | ---- | ------------- |
| `grilling` | mattpocock/skills | `skills/productivity/grilling` | `5beb35b040e3` | 2026-10-19 |  |
| `domain-modeling` | mattpocock/skills | `skills/engineering/domain-modeling` | `5beb35b040e3` | 2026-10-19 |  |
| `prototype` | mattpocock/skills | `skills/engineering/prototype` | `5beb35b040e3` | 2026-10-19 | LOGIC.md#3. Build the shareable HTML file (skills/lar-work/SKILL.md); LOGIC.md#4. Hand it over (skills/lar-work/SKILL.md); LOGIC.md#Anti-patterns (skills/lar-work/SKILL.md); UI.md#5. Hand it over (skills/lar-work/SKILL.md); SKILL.md#Rules that apply to both (skills/lar-work/SKILL.md) |
| `research` | mattpocock/skills | `skills/engineering/research` | `5beb35b040e3` | 2026-10-19 |  |
| `diagnosing-bugs` | mattpocock/skills | `skills/engineering/diagnosing-bugs` | `5beb35b040e3` | 2026-10-19 |  |
| `tdd` | mattpocock/skills | `skills/engineering/tdd` | `5beb35b040e3` | 2026-10-19 |  |
| `code-review` | mattpocock/skills | `skills/engineering/code-review` | `5beb35b040e3` | 2026-10-19 |  |
| `codebase-design` | mattpocock/skills | `skills/engineering/codebase-design` | `5beb35b040e3` | 2026-10-19 |  |
| `writing-for-agents` | mattpocock/skills | `skills/productivity/writing-for-agents` | `5beb35b040e3` | 2026-10-19 |  |
| `pr` | mattpocock/skills | `skills/engineering/pr` | `5beb35b040e3` | 2026-10-19 |  |
| `retro` | mattpocock/skills | `skills/engineering/retro` | `5beb35b040e3` | 2026-10-19 |  |
| `handoff` | mattpocock/skills | `skills/productivity/handoff` | `5beb35b040e3` | 2026-10-19 |  |
| `to-tickets` | mattpocock/skills | `skills/engineering/to-tickets` | `5beb35b040e3` | 2026-10-19 | SKILL.md#4. Quiz the user (skills/lar-work/agents/planner.md); SKILL.md#5. Publish the tickets to the configured tracker (skills/lar-work/agents/planner.md); SKILL.md#Blocked by (skills/lar-work/agents/planner.md) |
| `implement` | mattpocock/skills | `skills/engineering/implement` | `5beb35b040e3` | 2026-10-19 |  |
| `code-review-and-quality` | addyosmani/agent-skills | `skills/code-review-and-quality` | `aeac41d4d005` | 2026-10-13 |  |
| `security-and-hardening` | addyosmani/agent-skills | `skills/security-and-hardening` | `aeac41d4d005` | 2026-10-13 |  |
| `doubt-driven-development` | addyosmani/agent-skills | `skills/doubt-driven-development` | `aeac41d4d005` | 2026-10-13 |  |
| `frontend-ui-engineering` | addyosmani/agent-skills | `skills/frontend-ui-engineering` | `aeac41d4d005` | 2026-10-13 |  |
| `browser-testing-with-devtools` | addyosmani/agent-skills | `skills/browser-testing-with-devtools` | `aeac41d4d005` | 2026-10-13 |  |
| `references/security-checklist.md` | addyosmani/agent-skills | `references/security-checklist.md` | `aeac41d4d005` | 2026-10-13 |  |
| `references/performance-checklist.md` | addyosmani/agent-skills | `references/performance-checklist.md` | `aeac41d4d005` | 2026-10-13 |  |
| `references/orchestration-patterns.md` | addyosmani/agent-skills | `references/orchestration-patterns.md` | `aeac41d4d005` | 2026-10-13 |  |
| `references/accessibility-checklist.md` | addyosmani/agent-skills | `references/accessibility-checklist.md` | `aeac41d4d005` | 2026-10-13 |  |
| `unslop` | cursor/plugins | `pstack/skills/unslop` | `8b3326d99fd4` | 2026-10-22 |  |

Full commits: mattpocock/skills `5beb35b040e3de97e54fa9e386d7e42d15c295c2`, addyosmani/agent-skills `aeac41d4d005999432bb7312f7ff06383a91d59d`, cursor/plugins `8b3326d99fd4b993cb33a24dad8af03175c642c5`.

Addy's skills link to `../../references/`, so the board app copies `references/`
to `~/.agents/references/` and to each ticked Claude profile's `references/`, where
those links resolve.
