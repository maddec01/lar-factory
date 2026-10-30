# Skill source layout

Run `pnpm run assemble:skills` from the repository root. It replaces
`.assembled-skills/lar-shape` and `.assembled-skills/lar-build` from their
workflow source folders, then copies `skills/shared` into each output's
`shared/` folder. Outputs are generated and ignored by git. Release and runtime
consumers keep their current entry points until their migration slices.

Both workflows use `shared/skills/<name>/SKILL.md` for shared Copies.
Workflow Copies use `skills/<name>/SKILL.md` inside their consuming skill.
Move each Copy as a whole folder, including LICENSE and pr's CREDITS.md.
The installed paths below are relative to the installation's skills folder.

| Copy | Repository path | Installed path |
| --- | --- | --- |
| unslop | `skills/shared/skills/unslop` | `lar-shape/shared/skills/unslop; lar-build/shared/skills/unslop` |
| handoff | `skills/shared/skills/handoff` | `lar-shape/shared/skills/handoff; lar-build/shared/skills/handoff` |
| domain-modeling | `skills/shared/skills/domain-modeling` | `lar-shape/shared/skills/domain-modeling; lar-build/shared/skills/domain-modeling` |
| writing-for-agents | `skills/shared/skills/writing-for-agents` | `lar-shape/shared/skills/writing-for-agents; lar-build/shared/skills/writing-for-agents` |
| grilling | `skills/lar-shape/skills/grilling` | `lar-shape/skills/grilling` |
| prototype | `skills/lar-shape/skills/prototype` | `lar-shape/skills/prototype` |
| research | `skills/lar-shape/skills/research` | `lar-shape/skills/research` |
| diagnosing-bugs | `skills/lar-shape/skills/diagnosing-bugs` | `lar-shape/skills/diagnosing-bugs` |
| to-tickets | `skills/lar-build/skills/to-tickets` | `lar-build/skills/to-tickets` |
| implement | `skills/lar-build/skills/implement` | `lar-build/skills/implement` |
| tdd | `skills/lar-build/skills/tdd` | `lar-build/skills/tdd` |
| codebase-design | `skills/lar-build/skills/codebase-design` | `lar-build/skills/codebase-design` |
| pr | `skills/lar-build/skills/pr` | `lar-build/skills/pr` |
| retro | `skills/lar-build/skills/retro` | `lar-build/skills/retro` |
| code-review | `skills/lar-build/skills/code-review` | `lar-build/skills/code-review` |
| security-and-hardening | `skills/lar-build/skills/security-and-hardening` | `lar-build/skills/security-and-hardening` |
| frontend-ui-engineering | `skills/lar-build/skills/frontend-ui-engineering` | `lar-build/skills/frontend-ui-engineering` |
| review checklists and LICENSE | `skills/lar-build/references/` | `lar-build/references/` |

Review Copies live in `lar-build/skills/<name>/`, so their unchanged
`../../references/` links reach `lar-build/references/`.
The former developer-profile text is `skills/lar-build/coding-style.md`,
installed as `lar-build/coding-style.md`.

Runtime consumers must bundle `.assembled-skills/lar-shape` and
`.assembled-skills/lar-build`, after running the assembly command. Install
those folders whole, including `shared/`; no sibling skills or references
folder is needed. Build entry: `lar-build/agents/builder.md`; shaping entry:
`lar-shape/SKILL.md`. The workflow source `skills/lar-work` is removed.
