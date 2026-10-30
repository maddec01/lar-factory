# Issue tracking

A repository's provider is its origin's host. On GitHub, use the local `gh`
login and the sections below. On Azure DevOps, use the local `az login` and
[Azure DevOps](azure-devops.md#azure-devops), which says what replaces each GitHub section.
The **factory repository**, home of the workflow,
the board and cross-repository work, is `maddec01/lar-factory`, on GitHub. Read the
destination's `AGENTS.md` and issue conventions before writing. Choose
the destination explicitly, even when the checkout belongs to another
repository:

```sh
repo=maddec01/lar-factory
gh repo view "$repo" --json nameWithOwner,url
```

Set `repo` to the repository that will own the issue, and pass `--repo "$repo"`
to issue/label commands and `repos/$repo/...` to REST calls, so nothing depends
on the checkout. For a child in another repository, select that repository and
use the parent's full URL. Confirm access with `gh auth status` when needed.

## Slices

GitHub only; on Azure DevOps see [Azure slices](azure-devops.md#azure-slices). A slice is a native sub-issue of a `build` issue; a sub-issue labelled
`build` is a build, never a slice. Create it only with `slice.sh`: it makes the
sub-issue and prints its URL. The board shows slices inside their build's card,
with no board status of their own.
Then add its blocked-by links with `--add-blocked-by`
above.

```sh
bash <this skill>/shared/scripts/slice.sh "$repo" "$build" "<title>" /path/to/slice.md
```

An **active slice** carries the `active` label while
an implementer works on it; the board reads it to show progress. Add it when
the implementer starts and remove it when the slice merges or closes, when its
implementer reports it blocked, and when the build stops. A **blocked slice**
carries the `blocked` label (not a native blocked-by link): its implementer
couldn't finish it. The builder adds the label with a reason comment; a
re-slice planner claims the slice by removing it. Close a merged slice, then list the build's ready slices (open, not
blocked, every blocker closed):

```sh
gh issue edit "$slice" --repo "$repo" --add-label active     # or --remove-label; same for blocked

# On resume: clear active from every open slice (blocked stays).
gh issue list --repo "$repo" --label active --state open --json number,parent \
  --jq ".[] | select(.parent.number == $build) | .number" |
  xargs -I{} gh issue edit {} --repo "$repo" --remove-label active

# A slice reported blocked (the first line creates the label in repos set up before it).
gh api "repos/$repo/labels/blocked" --silent || gh label create blocked --repo "$repo" \
  --color BFD4F2 --description "Slice an implementer couldn't finish, waiting for a re-slice"
gh issue edit "$slice" --repo "$repo" --remove-label active --add-label blocked
reason=$(mktemp)  # write "Blocked: <implementer's reason>" to it
gh issue comment "$slice" --repo "$repo" --body-file "$reason"

# The build's open blocked slices.
gh issue list --repo "$repo" --label blocked --state open --json number,parent \
  --jq ".[] | select(.parent.number == $build) | .number"

gh issue close "$slice" --repo "$repo" --reason completed

gh api graphql -F owner="${repo%/*}" -F name="${repo#*/}" -F n="$build" -f query='
query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){
  subIssues(first:100){nodes{number title state labels(first:20){nodes{name}}
    blockedBy(first:50){nodes{state}}}}}}}' \
  --jq '.data.repository.issue.subIssues.nodes[]
    | select(.state == "OPEN" and all(.labels.nodes[]; .name != "blocked")
      and all(.blockedBy.nodes[]; .state == "CLOSED"))
    | "#\(.number) \(.title)"'
```

A **re-slice** works in place and keeps no history. The planner rewrites the
blocked slice (`gh issue edit --title --body-file`) to hold the work left and
may edit any other open slice without `active`. It creates a slice (with
`slice.sh`) only when the work needs another, and closes one only once its content moved into
another. Blocked-by links follow the content; a closed slice's dependents
move to the slice that took its work:

```sh
gh issue edit "$dependent" --repo "$repo" --add-blocked-by "$into" --remove-blocked-by "$slice"
gh issue close "$slice" --repo "$repo" --reason "not planned"
```

