# 1. Pick up


Resolve the argument to its work record with
`bash <this skill>/shared/scripts/work.sh <argument>` ([Picking](shared/issue-tracker/work-records.md#picking)).
If it fails, tell the user its reason and stop. Read the record, its initial
context (`lar-work context`), its brief, map or decision (`lar-work body`), its
parent, children and blockers, then route:

- A decision: [Decisions](concepts.md#decisions).
- A build, or a record with a passing brief, also when resuming a shaping
  handoff: set **Ready** if it isn't and stop; the board starts it
  (**5. Start the build**).
- Anything else: set Shaping. An **Explore subagent** reads the repo's
  `AGENTS.md`, its glossary and relevant ADRs ([where domain docs live](shared/domain-docs.md#where-domain-docs-live)),
  and the code this work touches, and returns ≤300 words in
  [domain-modeling](shared/domain-docs.md) vocabulary: what exists, where, and
  what the work would change. It also returns each onboarded repository's
  **role**: `bash <this skill>/shared/scripts/repo-config.sh --list` lists the
  repositories, and `bash <this skill>/shared/scripts/repo-config.sh <owner/repo>`
  (or an Azure repository's origin URL or `<org>/<project>/<repo>`) prints
  one's settings, this machine's over the repository's shared defaults (this
  checkout may be another repo's).

