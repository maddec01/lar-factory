---
name: skill-sync
description: Review upstream changes to the skills copied into mux-factory, take the ones Pedro picks, and add or drop copies. Use when the user runs /skill-sync.
disable-model-invocation: true
---

The copied skills in `maddec01/mux-factory` change only through this skill.
`UPSTREAM.md` records the upstream commit each copy matches.

Before writing anything, read the `unslop` skill
(`~/.claude/skills/unslop/SKILL.md` in Claude Code,
`~/.agents/skills/unslop/SKILL.md` in Codex) and follow its rules for all prose
you write: chat, commit messages, the PR body and `UPSTREAM.md`. Apply them while
drafting, as you write each sentence, not as a later scan-and-rewrite pass. Code
and copied files follow their own rules.

1. Work in a fresh branch `chore/skill-sync-<date>` of the mux-factory checkout
   (`~/Developer/Mux/mux-factory`), updated from `origin/main`.
2. Run `bash <this skill>/scripts/upstream-changes.sh <checkout>`. It prints, per
   copy, whether upstream changed since the recorded commit, the upstream commits
   and the diff.
3. For each changed copy, summarise in two or three lines what changed and what
   it would do to the factory, and give your recommendation (take, skip, or take
   part). Ask Pedro to pick, using numbered questions so he can answer in one
   message. In the same message ask whether he wants to add a copy (source repo,
   path, commit; HEAD unless he names one) or drop one.
4. Confirm each add and drop with Pedro before step 5:
   - **Add**: run
     `bash <this skill>/scripts/preview-copy.sh <owner/repo> <path> [commit]`.
     It prints the source's HEAD, the commit to copy, the files at the path
     and the source's licence files. Show Pedro that output and wait for his
     yes. If the script fails (no files at the path, unknown commit), stop and
     ask him for the source again. If it lists no licence files, tell him so
     before he confirms; add the copy without a `THIRD_PARTY_NOTICES.md`
     section only if he still says yes.
   - **Drop**: name what goes (the folder, its `UPSTREAM.md` row, and the
     source's full commit and notice if no other row uses that source) and
     wait for his yes.
5. Apply exactly what he confirmed:
   - **Take a change**: copy the upstream files over the copy (or apply the
     chosen hunks), and set that row's commit in `UPSTREAM.md` to the upstream
     commit you took. A skipped change keeps the old commit, so it shows up again
     next time; say so.
   - **Add**: copy the folder at that commit unchanged into `skills/<name>` (a
     file under `references/` goes to `references/`). Add its `UPSTREAM.md` row
     with the 12-character commit, and the source's full commit to the "Full
     commits" line. When the source is new, add its licence to
     `THIRD_PARTY_NOTICES.md` under a `## <owner/repo>` heading with its URL.
   - **Drop**: delete the copy and its `UPSTREAM.md` row. When no row uses its
     source any more, also remove that source's full commit and its
     `THIRD_PARTY_NOTICES.md` section. Tell Pedro the installed copies in
     `~/.agents/skills` and `~/.claude/skills` stay, since he uses them in
     projects outside the factory; he removes them by hand if he wants them gone.
6. Commit as `chore(skills): sync <names> from upstream` (`feat(skills): add
   <name> as a copy` or `chore(skills): drop <name>` for add and drop), push,
   and open a PR listing what was taken, skipped, added and dropped. Pedro
   merges it.
7. Tell him to start a Release after merging and install it. The board app's
   first launch of the new version updates the skills and the checklists in
   `references/`, and installs an added copy with no further edit.

Never edit a copy for Mux reasons. Mux rules belong in `mux-work` or a repo's
`AGENTS.md`.
