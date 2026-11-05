# 1. Pick up


Resolve the argument to its work record with
`bash <this skill>/shared/scripts/work.sh <argument>` ([Picking](shared/issue-tracker/work-records.md#picking)).
If it fails, tell the user its reason and stop. Read the record, its initial
context (`lar-work context`), its brief, map or decision (`lar-work body`), its
parent, children and blockers. Before accepting an existing passing brief,
run `lar-work gate <work ID>` to refresh its ticket Spec, inspect the sync
warnings and held edits, then reread the brief and revision. A Reshape
item keeps its brief text and gate history but has no current passing gate.
Send it through Gate again before marking it Ready. Follow
[Gate](gate.md) when the text changed or an edit needs approval. Then route:

- A decision: [Decisions](concepts.md#decisions).
- A record with a current passing brief, also when resuming a shaping
  handoff: set **Ready** if it isn't and stop; report its readiness and leave the start to the board. A Ready build waits for the user's Start build on the board. The exception is Auto-build. With this machine's Auto-build switch on, the board starts eligible Ready builds by itself, up to the build limit. Auto-build starts a build under a concept only once the concept's Refinement is complete.
- Anything else: set Shaping. An **Explore subagent** reads existing project instructions when present,
  neighboring code conventions, its glossary and relevant ADRs ([where domain docs live](shared/domain-docs.md#where-domain-docs-live)),
  and the code this work touches, and returns ≤300 words in
  [domain-modeling](shared/domain-docs.md) vocabulary: what exists, where, and
  what the work would change. By default it runs no test suite, build, typecheck
  or lint. It may run the smallest command that settles a specific uncertainty
  reading cannot settle, and names that uncertainty in its report. It runs each
  heavy command (a whole test suite, a production build, a performance
  measurement, or anything expected to take over about a minute) on its own as
  `lar-work heavy -- <command>`, in the foreground with its tool's longest
  timeout. It also returns each onboarded repository's
  **role**: `bash <this skill>/shared/scripts/repo-config.sh --list` lists the
  repositories, and `bash <this skill>/shared/scripts/repo-config.sh <owner/repo>`
  (or an Azure repository's origin URL or `<org>/<project>/<repo>`) prints
  one's local machine settings. The checkout may be another repository's.
  Missing instructions, glossary or ADRs never block shaping.

