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

For each repository whose code or contracts inform this work, run
`bash <this skill>/shared/scripts/shaping-base.sh <checkout>` first. It discovers
origin's advertised default, fetches it and returns its ref and exact revision;
the project's local branch, origin/HEAD and working files may be stale. If this
fails, resolve the access/fetch problem before making code or scope claims;
never fall back to local main. Repeat on resumed shaping before new claims.

Read the returned revision with `git -C <checkout> show <revision>:<path>`,
`git -C <checkout> grep <pattern> <revision> -- <paths>` and `git ls-tree`,
not files from the current checkout. If tools need working files, use a detached
scratch worktree at that revision. Leave the project's branch and edits alone.
Read repository glossary/ADRs at that same revision; machine-local domain docs
stay at their configured paths. Save each repository, ref and full revision with
the findings in local thread evidence and carry them in handoffs and delegated
reports, never in the team-facing Spec. Refresh affected repositories after a
related merge before settling a contract or correcting a brief.

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
