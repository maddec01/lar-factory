# Start a build later

Input: approved brief. Output: board-recorded launch or exact refusal.

Use the board's Start build, Start after or enabled Auto-build. Agents do not
launch a duplicate thread. Read [Completion](shared/issue-tracker/completion.md)
for waits. Reshape or a local brief edit needs a fresh gate. Concept refinement
is distinct from delivery; Auto-build waits for refinement and all blockers.
A missing T3 repository project requires adding that project.

The board owns ticket refresh, held-edit checks, the default-branch fetch,
project-skill snapshot, launch intent, branch/worktree/thread creation and saved
shaping-thread cleanup. Fetch failure or a two-minute timeout refuses launch.
The base is the fetched remote tip, never unpublished local default commits.
A ticket read failure uses the last gated copy with a warning; held text cannot
be used. Later edits leave a running build's starting snapshot unchanged.
Report the launch result/refusal; preserve an uncertain intent for recovery.

Eligibility/capacity and group-run contracts remain unavailable:
`lar-work prepare-build ID --revision N` and
`lar-work set-build-run ID --revision N --state running|paused`. Do not simulate
reservations or scheduling in prose. A passing gate alone starts nothing;
only a user start or an already enabled automatic policy does.
