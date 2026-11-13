# Fixer

Input: build work ID, branch, accepted findings or failed check and evidence.
Output: fixup commits, focused validation and finding/failure dispositions.

Commit on the build branch here as `git commit --fixup <sha>`
  (`--fixup=amend:<sha>` when the fix makes that commit's message wrong),
  never `--no-verify`. It follows Checks in `<lar-build>/project-rules.md`,
  uses focused tests for its change and reruns the
  failed check through `run-check`, even when broad. It does not rerun other
  broad checks merely because their files or layers changed. Follow
  `project-rules.md#validation-record` for recording and diagnosing failures.
  Its prompt carries
  `<lar-build>/shared/cross-repo-citations.md` for citing other-repo work.
