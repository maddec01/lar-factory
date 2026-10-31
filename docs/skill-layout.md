# Skill source layout

Run `pnpm run assemble:skills` at the root. It replaces the generated
`.assembled-skills/lar-shape` and `.assembled-skills/lar-build` folders with each
workflow's source and a copy of `skills/shared` in its own `shared/` folder.
`.assembled-skills/skills` contains the two complete installable folders.
Generated files are ignored by git.

The shaping entry is `lar-shape/SKILL.md`. The build entry is
`lar-build/agents/builder.md`. Each thread carries the factory guidance it needs;
target repositories need no factory setup or instruction files.

Shared workflow text is lar-owned or a Port listed in `UPSTREAM.md`.
Review Copies live in `skills/lar-build/skills/`. Checklists live in
`skills/lar-build/references/`, where the Copies' unchanged relative links resolve.
`lar-build/coding-style.md` contains fallback coding guidance. Existing project
conventions take precedence.

Edit Ports and lar-owned files directly. Update Copies through `skill-sync`.
An Override belongs beside the lar step loading the Copy, cites the exact Copy
file and heading, and appears in that Copy's `UPSTREAM.md` row. Assembly copies
Copies unchanged, including their licences.

The desktop bundle consumes `.assembled-skills/skills`. Run
`bash scripts/assemble-skills.test.sh` after changing workflow files or shared
references to check generated contents, local links and unchanged Copies.
