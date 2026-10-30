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
description with the patch in [Azure slices](azure-devops.md#azure-slices):

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
child_url=$(bash <this skill>/shared/scripts/slice.sh "$azure_repo" "$parent_url" "Decide the approach" /path/to/decision.md)
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
build_url=$(bash <this skill>/shared/scripts/slice.sh "$azure_repo" "$item_url" "<title>" /path/to/brief.md)
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
`bash <this skill>/shared/scripts/slice.sh "$azure_repo" "$build_url" "<title>" /path/to/slice.md`,
which creates an untagged Task, then add its predecessor links. Slices carry
only slice tags (`active` or `blocked`), with no factory Status; reserve `build`,
`decision-*` and `concept` for board items. The `active` and
`blocked` tags mean what the labels mean in [Slices](slices.md#slices).

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

The rule in [Parent closing](parent-closing.md#parent-closing) holds. The build's parent is its
`System.Parent` field (`az boards work-item show --id "$build" --query
'fields."System.Parent"'`), a build when its tags hold `build`. List the
parent's open children as above and leave out this build and its predecessors;
none left, and the parent isn't a build, means this build's PR completes it.
