# Issue tracking

A repository's provider is its origin's host. On GitHub, use the local `gh`
login and the sections below. On Azure DevOps, use the local `az login` and
[Azure DevOps](#azure-devops), which says what replaces each GitHub section.
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

## Label setup

GitHub only: Azure DevOps creates a tag the first time an item gets it. Run this block once per destination, before applying workflow labels or
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
decision-grill|D4C5F9|Concept decision settled by questions
decision-prototype|D4C5F9|Concept decision settled by a prototype
decision-research|D4C5F9|Concept decision settled by research
decision-task|D4C5F9|Concept decision settled by a small task
build|0E8A16|Issue that becomes one PR
active|FBCA04|Slice an implementer is working on now
blocked|BFD4F2|Slice an implementer couldn't finish, waiting for a re-slice
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

All eleven names above must be present. The block doesn't create the
`status-<name>` labels: `status.sh` and the board create each one when it's
first needed.

## Status

Status lives on the item. The statuses are List, Queued, Shaping, Needs you,
Ready, In progress, Review, Verify, Ready to merge and Done. A repository's
`.lar-factory.json` names its item source. GitHub issues keep their status as
`status-<name>` labels, and an Azure DevOps
work item as `status-<name>` tags: the status lowercased with
hyphens for spaces, such as `status-shaping` or `status-ready-to-merge`. An issue carries one. No write
stores Done: closing the issue, or moving the work item to a Completed-category
State, makes it Done.

Move an item with `bash <lar-work>/../shared/scripts/status.sh <issue-url> "<Status>"`
as the workflow directs, passing a work item's URL on Azure DevOps. It swaps the
issue's label or the work item's tag. On a work
item it also moves State when the state category changes: the first
InProgress-category state for any status after Queued, the first
Proposed-category state for List or Queued. It refuses Done, a pull request,
and an issue with two status labels until someone removes all but one.

## Native relationships

GitHub only; on Azure DevOps see [Children and blockers](#children-and-blockers). Check `gh issue create --help` and `gh issue edit --help` for `--parent`,
`--add-sub-issue` and `--add-blocked-by`. Replace the example issue numbers
(in `$repo`) before running; use full issue URLs for cross-repository parents or
blockers, and `--body-file` for multiline bodies.

```sh
parent=100
child=101
blocker=102
child_repo=$repo

# Create a decision as a native sub-issue; retain the returned URL immediately.
# Slices are created with slice.sh instead (see Slices).
gh issue create --repo "$repo" --title "Decide the approach" \
  --body-file /path/to/decision.md --label "decision-grill" --parent "$parent"

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

GitHub only; on Azure DevOps see [Azure slices](#azure-slices). A slice is a native sub-issue of a `build` issue; a sub-issue labelled
`build` is a build, never a slice. Create it only with `slice.sh`: it makes the
sub-issue and prints its URL. The board shows slices inside their build's card,
with no board status of their own.
Then add its blocked-by links with `--add-blocked-by`
above.

```sh
bash <lar-work>/../shared/scripts/slice.sh "$repo" "$build" "<title>" /path/to/slice.md
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

## Parent closing

The commands here are GitHub only; on Azure DevOps see [Azure parent closing](#azure-parent-closing). A build closes its parent when the parent isn't a build and every other open
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

Follow [Retro capture](../shared/retro-capture.md), with its persisted plan, stable
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

## Azure DevOps

A repository whose origin is on Azure DevOps keeps its items as work items in
its project, read and written with the local `az login` and the `azure-devops`
extension. When `az` says it is logged out, run `az login`; when it doesn't know
`boards`, run `az extension add --name azure-devops`. Then rerun.

Take the organization and project from the origin
(`https://dev.azure.com/<org>/<project>/_git/<repo>`; `scripts/azure.sh` lists
the other forms), with the project name as Azure shows it, `%20` turned back
into a space. A work item's id ends its URL
(`https://dev.azure.com/<org>/<project>/_workitems/edit/<id>`). The scripts
take the repository as its origin URL or `<org>/<project>/<repo>`.

```sh
org=https://dev.azure.com/<org>
project="<project>"
azure_repo=<org>/<project>/<repo>
```

Pass `--organization "$org"` to every command and `--api-version` to every
`az devops invoke`, which otherwise defaults to 5.0. Each GitHub idea maps to
one on Azure DevOps:

| GitHub | Azure DevOps |
| --- | --- |
| issue | work item |
| label (kind, `decision-*`, `concept`, `build`, `active`, `blocked`, `status-*`) | tag in `System.Tags`, with the same name |
| sub-issue, slice | child Task |
| blocked-by link | Predecessor link: the blocker is the waiting item's predecessor |
| closed as completed | its type's first Completed-category State |
| closed as not planned | its type's Removed-category State |

Read and comment on a work item:

```sh
az boards work-item show --id "$id" --expand all --organization "$org"
az devops invoke --area wit --resource comments --organization "$org" \
  --route-parameters project="$project" workItemId="$id" --api-version 7.1-preview.4 \
  --query 'comments[].{by: createdBy.displayName, date: createdDate, text: text}'

comment=$(mktemp)
jq -n --rawfile text /path/to/comment.md '{text: $text}' >"$comment"
az devops invoke --area wit --resource comments --organization "$org" \
  --route-parameters project="$project" workItemId="$id" --query-parameters format=markdown \
  --http-method POST --in-file "$comment" --api-version 7.1-preview.4 --output none
```

A new top-level item (retro capture's) is a work item of the team's
requirement type: User Story, Product Backlog Item, Issue or Requirement, as
the process names it. Tag it `repo-<repo>` and its kind, then set its markdown
description with the patch in [Azure slices](#azure-slices):

```sh
id=$(az boards work-item create --type "<requirement type>" --title "<title>" \
  --project "$project" --organization "$org" --query id -o tsv)
```

### Tags

`System.Tags` is one string, `a; b`, and each write replaces all of it, so
read it first. Tag names are case sensitive, hold no comma or semicolon, and a
work item holds up to 100. `status.sh` owns the `status-*` tags; change the
others with `retag`:

```sh
# retag <id> <tag to remove or ""> <tag to add or "">
retag() {
  local tags
  tags=$(az boards work-item show --id "$1" --organization "$org" --query 'fields."System.Tags"' -o tsv)
  tags=$({ tr ';' '\n' <<<"$tags" | sed 's/^ *//; s/ *$//' | grep -Fxv -e "$2" -e "$3" -e '' || true
    if [ -n "$3" ]; then echo "$3"; fi; } | paste -sd ';' - | sed 's/;/; /g')
  az boards work-item update --id "$1" --organization "$org" --fields "System.Tags=$tags" --output none
}
```

To find the work items carrying a tag, ask WIQL:

```sh
az boards query --organization "$org" --project "$project" \
  --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS 'active'"
```

### Children and blockers

Every child is a Task: a decision, a slice, and a build in another repository.
Create one with `slice.sh` given the parent's work item URL. It prints the
child's URL; retain it at once, then add the child's tags. Tasks with `build`,
`decision-*`, `concept` or a valid `status-*` tag appear on the board, including
factory children found through their parent's links outside the sprint.
Tag every decision `decision-<method>` and every build `build`; a kind or
`repo-` tag alone does not make a Task a board item. Plain team Tasks stay
off the board and contribute only to parent counts:

```sh
child_url=$(bash <lar-work>/../shared/scripts/slice.sh "$azure_repo" "$parent_url" "Decide the approach" /path/to/decision.md)
child=${child_url##*/}
retag "$child" "" "decision-grill"

# Or attach an existing work item as a child.
az boards work-item relation add --id "$child" --relation-type parent --target-id "$parent" --organization "$org"

# The child waits for the blocker, not the other way around.
az boards work-item relation add --id "$child" --relation-type predecessor --target-id "$blocker" --organization "$org"
az boards work-item relation remove --id "$child" --relation-type predecessor --target-id "$blocker" --organization "$org" --yes
```

Verify the links with a read, also before retrying a failed or uncertain
write. A parent link is `System.LinkTypes.Hierarchy-Reverse`, a child
`Hierarchy-Forward`, a predecessor `System.LinkTypes.Dependency-Reverse`;
each URL ends in the linked work item's id:

```sh
az boards work-item show --id "$child" --expand relations --organization "$org" \
  --query 'relations[].{rel: rel, url: url}'
```

**Work in another repository.** When shaping finds that another Azure
repository changes, that work is a build: a child Task of the item, tagged
`build`, `repo-<that repository>` (its name as Azure shows it) and its kind,
that the item waits for. Reuse an open child Task that covers the work.

```sh
build_url=$(bash <lar-work>/../shared/scripts/slice.sh "$azure_repo" "$item_url" "<title>" /path/to/brief.md)
build=${build_url##*/}
retag "$build" "" build
retag "$build" "" "repo-<that repository>"
retag "$build" "" "<kind>"
az boards work-item relation add --id "$item" --relation-type predecessor --target-id "$build" --organization "$org"
```

The board writes the item's own `repo-` tag when someone takes it; this is the
only `repo-` tag lar-work writes. Work in a repository on another provider has
no link between providers yet: tell the user and leave it out.

### Azure slices

A slice is a child Task of a work item tagged `build`; a child tagged `build`
is a build, never a slice. Create it with
`bash <lar-work>/../shared/scripts/slice.sh "$azure_repo" "$build_url" "<title>" /path/to/slice.md`,
which creates an untagged Task, then add its predecessor links. Slices carry
only slice tags (`active` or `blocked`), with no factory Status; reserve `build`,
`decision-*` and `concept` for board items. The `active` and
`blocked` tags mean what the labels mean in [Slices](#slices).

```sh
retag "$slice" "" active          # retag "$slice" active "" to remove it
retag "$slice" active blocked     # a slice reported blocked; then comment the reason

# The first State of a category (Proposed, InProgress, Resolved, Completed, Removed) for a type.
state_in() {
  az devops invoke --area wit --resource workitemtypestates --organization "$org" \
    --route-parameters project="$project" type="$1" --api-version 7.1 \
    --query "value[?category=='$2'].name | [0]" -o tsv
}
az boards work-item update --id "$slice" --organization "$org" --state "$(state_in Task Completed)" --output none

# The build's children: id, title, State, tags and predecessor ids.
az boards work-item show --id "$build" --expand relations --organization "$org" \
  --query "relations[?rel=='System.LinkTypes.Hierarchy-Forward'].url" -o tsv |
  while read -r u; do
    az boards work-item show --id "${u##*/}" --expand relations --organization "$org" -o json |
      jq -c '{id, title: .fields["System.Title"], state: .fields["System.State"],
        tags: (.fields["System.Tags"] // ""),
        after: [.relations[]? | select(.rel == "System.LinkTypes.Dependency-Reverse") | .url | split("/")[-1]]}'
  done
```

A child is open while its State is in neither the Completed nor the Removed
category. On resume, clear `active` from every open slice in that list. A
ready slice is open, has no `blocked` tag, and each of its predecessors is in
a Completed-category State. Close a slice whose work moved elsewhere in the
Task's Removed-category State (`state_in Task Removed`). A re-slice rewrites
the title and the markdown description in one patch:

```sh
patch=$(mktemp)
jq -n --arg title "<title>" --rawfile body /path/to/slice.md '[
  {op: "replace", path: "/fields/System.Title", value: $title},
  {op: "replace", path: "/fields/System.Description", value: $body},
  {op: "add", path: "/multilineFieldsFormat/System.Description", value: "Markdown"}]' >"$patch"
az devops invoke --area wit --resource workitems --organization "$org" --route-parameters id="$slice" \
  --http-method PATCH --media-type application/json-patch+json --in-file "$patch" \
  --api-version 7.2-preview.3 --output none
```

### Azure parent closing

The rule in [Parent closing](#parent-closing) holds. The build's parent is its
`System.Parent` field (`az boards work-item show --id "$build" --query
'fields."System.Parent"'`), a build when its tags hold `build`. List the
parent's open children as above and leave out this build and its predecessors;
none left, and the parent isn't a build, means this build's PR completes it.
