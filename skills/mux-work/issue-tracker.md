# Issue tracking

Use the local `gh` login. The **factory repository**, home of the workflow,
the board and cross-repository work, is `maddec01/mux-factory`. Read the
destination's `AGENTS.md` and issue conventions before writing. Choose
the destination explicitly, even when the checkout belongs to another
repository:

```sh
repo=maddec01/mux-factory
gh repo view "$repo" --json nameWithOwner,url
```

Set `repo` to the repository that will own the issue, and pass `--repo "$repo"`
to issue/label commands and `repos/$repo/...` to REST calls, so nothing depends
on the checkout. For a child in another repository, select that repository and
use the parent's full URL. Confirm access with `gh auth status` when needed.

## Label setup

Run this block once per destination, before applying workflow labels or
creating labelled issues. It needs permission to manage the destination's
labels, creates only missing ones (existing names, colours and descriptions stay
intact), and exits nonzero on any read or creation failure.

```bash
(
  set -euo pipefail
  : "${repo:?Set repo to the destination owner/repo first}"
  existing=$(gh api --paginate "repos/$repo/labels" --jq '.[].name')
  while IFS='|' read -r name color description; do
    if grep -Fxq -- "$name" <<<"$existing"; then
      continue
    fi
    gh label create "$name" --repo "$repo" \
      --color "$color" --description "$description"
  done <<'LABELS'
bug|D73A4A|Something broken
feature|A2EEEF|New behaviour
improvement|1D76DB|Better existing behaviour
concept|5319E7|A map of work needing decisions and builds
decision: grill|D4C5F9|Concept decision settled by questions
decision: prototype|D4C5F9|Concept decision settled by a prototype
decision: research|D4C5F9|Concept decision settled by research
decision: task|D4C5F9|Concept decision settled by a small task
build|0E8A16|Issue that becomes one PR
active|FBCA04|Slice an implementer is working on now
LABELS
)
```

On failure, fix the reported access/network/API problem and rerun the whole
block for the same destination; it skips completed creations. It never updates
an existing label: a changed description (such as `build`'s) is a one-off
`gh label edit "$name" --repo "$repo" --description "<new>"`. Never add
`--force`, delete existing labels or suppress errors to make setup pass. Confirm
the result:

```sh
gh api --paginate "repos/$repo/labels" --jq '.[].name'
```

All ten names above must be present. List, Queued, Shaping, Needs you, Ready,
In progress, Review, Verify, Ready to merge and Done are **Project Status
values**, not labels: move them with `bash <mux-work>/scripts/status.sh
<issue-url> "<Status>"` as the workflow directs.

## Native relationships

Check `gh issue create --help` and `gh issue edit --help` for `--parent`,
`--add-sub-issue` and `--add-blocked-by`. Replace the example issue numbers
(in `$repo`) before running; use full issue URLs for cross-repository parents or
blockers, and `--body-file` for multiline bodies.

```sh
parent=100
child=101
blocker=102
child_repo=$repo

# Create a decision as a native sub-issue; retain the returned URL immediately.
gh issue create --repo "$repo" --title "Decide the approach" \
  --body-file /path/to/decision.md --label "decision: grill" --parent "$parent"

# Or attach an existing child to the map.
gh issue edit "$parent" --repo "$repo" --add-sub-issue "$child"

# The child waits for the blocker, not the other way around.
gh issue edit "$child" --repo "$repo" --add-blocked-by "$blocker"
```

Without those flags, use the REST equivalents below. URL/path issue numbers
(`100`, `101`, `102`) differ from numeric REST database IDs (`.id`), and
`gh issue view --json id` returns a GraphQL node ID: pass only `.id` to these
REST mutations.

```sh
child_repo=$repo
blocker_repo=$repo
# For cross-repository relationships, change child_repo/blocker_repo explicitly.
child_id=$(gh api "repos/$child_repo/issues/$child" --jq '.id')
blocker_id=$(gh api "repos/$blocker_repo/issues/$blocker" --jq '.id')

gh api --method POST "repos/$repo/issues/$parent/sub_issues" \
  -F sub_issue_id="$child_id"
gh api --method POST "repos/$child_repo/issues/$child/dependencies/blocked_by" \
  -F issue_id="$blocker_id"
```

`-F` sends the IDs as JSON numbers. Verify the relationships with read-only
calls, also before retrying a failed or uncertain mutation:

```sh
gh api --paginate "repos/$repo/issues/$parent/sub_issues" \
  --jq '.[] | {number, id, html_url}'
gh api --paginate "repos/$child_repo/issues/$child/dependencies/blocked_by" \
  --jq '.[] | {number, id, html_url, state}'
```

Confirm the intended child's and blocker's URLs appear; a `Part of #n` mention
or Mermaid edge creates neither relationship. If a write fails, inspect the
existing relationships before retrying, and surface permission, validation and
conflicting-parent errors instead of falling back to mentions.

REST reference: GitHub's [sub-issues API](https://docs.github.com/en/rest/issues/sub-issues)
and [issue dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies).

## Slices

A slice is a native sub-issue of a `build` issue; a sub-issue labelled
`build` is a build, never a slice. Create it and its
blocked-by links with the commands above (`--parent "$build"`, then
`--add-blocked-by`). An **active slice** carries the `active` label while
an implementer works on it; the board reads it to show progress. Add it when
the implementer starts and remove it when the slice merges or closes, when its
implementer reports it blocked, and when the build stops. Close a merged slice,
then list the build's ready slices (open, every blocker closed):

```sh
gh issue edit "$slice" --repo "$repo" --add-label active
gh issue edit "$slice" --repo "$repo" --remove-label active

# On resume: clear active from every open slice.
gh issue list --repo "$repo" --label active --state open --json number,parent \
  --jq ".[] | select(.parent.number == $build) | .number" |
  xargs -I{} gh issue edit {} --repo "$repo" --remove-label active

gh issue close "$slice" --repo "$repo" --reason completed

# A re-sliced slice: repoint each dependent, then close the old slice.
gh issue edit "$dependent" --repo "$repo" --add-blocked-by "$new" --remove-blocked-by "$slice"
gh issue close "$slice" --repo "$repo" --reason "not planned"

gh api graphql -F owner="${repo%/*}" -F name="${repo#*/}" -F n="$build" -f query='
query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){
  subIssues(first:100){nodes{number title state blockedBy(first:50){nodes{state}}}}}}}' \
  --jq '.data.repository.issue.subIssues.nodes[]
    | select(.state == "OPEN" and all(.blockedBy.nodes[]; .state == "CLOSED"))
    | "#\(.number) \(.title)"'
```

## Parent closing

A build closes its parent when the parent isn't a build and every other open
sub-issue of it blocks this build. Print the build's parent (or `no parent`),
whether it's a build, then the parent's other open sub-issues that don't block
this build (none printed and not a build: this build's PR closes it):

```sh
parent_url=$(gh issue view "$build" --repo "$repo" --json parent --jq '.parent.url // empty')
if [ -z "$parent_url" ]; then echo "no parent"; else
  echo "parent: $parent_url"
  gh issue view "$parent_url" --json labels --jq 'if any(.labels[]; .name == "build") then "parent is a build" else "parent is not a build" end'
  blockers=$(gh api --paginate "repos/$repo/issues/$build/dependencies/blocked_by" --jq '.[].html_url')
  gh api --paginate "repos/${parent_url#https://github.com/}/sub_issues" \
    --jq ".[] | select(.state == \"open\" and .html_url != \"https://github.com/$repo/issues/$build\") | .html_url" |
    grep -Fxv -f <(printf '%s\n' "$blockers") || true
fi
```

## Capture-only Concepts

Follow [Retro capture](retro-capture.md), with its persisted plan, stable
selection IDs, reconciliation and visibility rules. A selected suggestion
spanning repositories goes to the factory repository, even when the source
issue and checkout are in another repository. Run label setup there after
persisting the plan and before creating a missing concept.

This path creates or reuses only the concept map: the `concept` label and the
sections in [Concepts](concepts.md), affected repositories in Destination, and
decomposition left in Fog with no sub-issues yet. Retain the URL and put a new
concept in List; keep a reused concept's status and the source issue's final
status. Decisions, native sub-issues and blocked-by edges come later in
shaping; run none of the mutation examples above during capture.
