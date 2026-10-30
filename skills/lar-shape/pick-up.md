# 1. Pick up


Read the issue with comments, parent, sub-issues and blockers, then route:

- **Unfinished retro capture record** (first, even over a passing brief):
  finish only that capture per [Retro capture](shared/retro-capture.md), keeping the
  source status. Rerun no build or retro; start no shaping or thread. Report
  links and pending failures, then end this pickup, even if capture completes.
- A `decision-*` sub-issue: [Decisions](concepts.md#decisions).
- A `build` sub-issue, or a passing brief in the body, also when resuming a
  shaping handoff: set **Ready** if it isn't and stop; the board starts it
  (**5. Start the build**).
- Anything else: set Shaping. An **Explore subagent** reads the repo's
  `AGENTS.md`, `GLOSSARY.md`, relevant ADRs and the code this issue touches,
  and returns ≤300 words in [domain-modeling](shared/domain-docs.md) vocabulary: what exists, where,
  and what the issue would change. It also returns each onboarded repository's **role**:
  `bash <this skill>/shared/scripts/repo-config.sh --list` lists the repositories, and
  `bash <this skill>/shared/scripts/repo-config.sh <owner/repo>` (or an Azure
  repository's origin URL or `<org>/<project>/<repo>`) prints one's config,
  read from its default branch (this checkout may be another repo's).

