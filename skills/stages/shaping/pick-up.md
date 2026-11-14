# 1. Pick up

Input: work reference and saved context. Output: resolved work ID, refreshed gate
and route; exploration evidence for new shaping.


Resolve the argument to its work record with
`bash <this skill>/shared/scripts/work.sh <argument>` ([Picking](shared/issue-tracker/work-records.md#picking)).
If it fails, tell the user its reason and stop. Read the record, its initial
context (`lar-work context`), its brief, map or decision (`lar-work body`), its
parent, children, blockers and Dependencies. Before accepting an existing passing brief,
run `lar-work gate <work ID>` to refresh its ticket Spec, inspect the sync
warnings and held edits, then reread the brief and revision. A Reshape
item keeps its brief text and gate history but has no current passing gate.
Send it through Gate again with new final confirmation before marking it Ready. Follow
[Gate](gate.md) when the text changed or an edit needs approval. Then route:

- A decision: [Decisions](decisions.md).
- A record with a current passing brief, also when resuming a shaping
  handoff: accept it only when gate evidence records explicit user approval of
  the current digest. If that evidence is missing, follow [Gate](gate.md),
  including final confirmation. Otherwise set **Ready** if it isn't and stop;
  report its readiness. [Gate](gate.md) owns the Ready handback.

- Anything else: set Shaping. Read local settings with `repo-config.sh` and
  delegate [Explore](#explore) with the configured glossary/ADR paths.

## Explore

Follow project instructions already supplied. Do not search for repository guidance or config files
in the checkout or its parents. Read neighboring code, the glossary and relevant ADRs
at paths supplied from local Project settings,
  and the code this work touches, and returns ≤300 words in
  the project's vocabulary: what exists, where, and
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
  Missing glossary or ADRs never block shaping.
