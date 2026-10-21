# Upstream

Every copied skill, where it came from, and the upstream commit it matches.
`skill-sync` compares each copy with upstream from this commit and updates this
file when you take changes. Copies are never edited by hand; Mux rules live in
`mux-work` and in each repo's `AGENTS.md`.

| Skill | Source | Path | Commit |
| ----- | ------ | ---- | ------ |
| `grilling` | mattpocock/skills | `skills/productivity/grilling` | `5beb35b040e3` |
| `domain-modeling` | mattpocock/skills | `skills/engineering/domain-modeling` | `5beb35b040e3` |
| `prototype` | mattpocock/skills | `skills/engineering/prototype` | `5beb35b040e3` |
| `research` | mattpocock/skills | `skills/engineering/research` | `5beb35b040e3` |
| `diagnosing-bugs` | mattpocock/skills | `skills/engineering/diagnosing-bugs` | `5beb35b040e3` |
| `tdd` | mattpocock/skills | `skills/engineering/tdd` | `5beb35b040e3` |
| `code-review` | mattpocock/skills | `skills/engineering/code-review` | `5beb35b040e3` |
| `codebase-design` | mattpocock/skills | `skills/engineering/codebase-design` | `5beb35b040e3` |
| `writing-for-agents` | mattpocock/skills | `skills/productivity/writing-for-agents` | `5beb35b040e3` |
| `pr` | mattpocock/skills | `skills/engineering/pr` | `5beb35b040e3` |
| `retro` | mattpocock/skills | `skills/engineering/retro` | `5beb35b040e3` |
| `handoff` | mattpocock/skills | `skills/productivity/handoff` | `5beb35b040e3` |
| `code-review-and-quality` | addyosmani/agent-skills | `skills/code-review-and-quality` | `aeac41d4d005` |
| `security-and-hardening` | addyosmani/agent-skills | `skills/security-and-hardening` | `aeac41d4d005` |
| `doubt-driven-development` | addyosmani/agent-skills | `skills/doubt-driven-development` | `aeac41d4d005` |
| `frontend-ui-engineering` | addyosmani/agent-skills | `skills/frontend-ui-engineering` | `aeac41d4d005` |
| `browser-testing-with-devtools` | addyosmani/agent-skills | `skills/browser-testing-with-devtools` | `aeac41d4d005` |
| `references/security-checklist.md` | addyosmani/agent-skills | `references/security-checklist.md` | `aeac41d4d005` |
| `references/performance-checklist.md` | addyosmani/agent-skills | `references/performance-checklist.md` | `aeac41d4d005` |
| `references/orchestration-patterns.md` | addyosmani/agent-skills | `references/orchestration-patterns.md` | `aeac41d4d005` |
| `references/accessibility-checklist.md` | addyosmani/agent-skills | `references/accessibility-checklist.md` | `aeac41d4d005` |

Full commits: mattpocock/skills `5beb35b040e3de97e54fa9e386d7e42d15c295c2`, addyosmani/agent-skills `aeac41d4d005999432bb7312f7ff06383a91d59d`.

Addy's skills link to `../../references/`. `npx skills add` installs only the
skill folders, so `scripts/install.sh` also copies `references/` to
`~/.agents/references/` and `~/.claude/references/`, where those links resolve.
