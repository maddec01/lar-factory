# Close during shaping

Use only after the user explicitly chooses to close this work without a build.
Reuse that decision; do not ask for another approval. Keep the work ID, ticket,
context and threads. Do not set Done: this is set-aside work, not a delivered build.

Choose one short reason for the team, such as `as already fixed on main @88490ab`.
Keep it to one line, with no workflow narration, labels, extra issues or Spec edits.
For GitHub, close with `gh issue close <number> --repo <owner/repo> --reason 'not planned' --comment 'Closed as already fixed on main @88490ab.'`.
This one close note is the only comment. If the close partly fails, read the
issue and its comments before retrying; never post the same reason twice.
For Azure follow [Azure DevOps](shared/issue-tracker/azure-devops.md): add the
one-line reason as a discussion note, preserve the team's State, and set the work
aside locally. A note failure leaves the item visible for retry.

After the provider confirms the close (or the Azure note), reread the record.
For a closed ticket, record `lar-work observe ID --revision N --of ticket --state closed`.
Then reread and run `lar-work set-aside ID --revision N --reason "as already fixed on main @88490ab"`.
If there are dependents, resolve every one through [Structure](shared/issue-tracker/structure.md)
and pass its `--file` with the same close reason; never bypass a retirement refusal.
Local work with no ticket only needs set-aside with the reason.
A failed provider action is not a close: report it and leave the work visible.
If the provider succeeded but the local write failed, retry only the local write.

Report the outcome and reason. The board announces the close and keeps the work
and reason in Archive and Board search, subject to the machine's retention setting.
