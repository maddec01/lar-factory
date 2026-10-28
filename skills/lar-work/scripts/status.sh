#!/bin/bash
# Usage: status.sh <owner/repo#number | issue, PR or Azure work item URL> <Status>
# Sets the item's Status on the item, as the item's repository config from
# repo-config.sh says. An issue from a repository that reads its issues swaps its
# status-<name> label for the new one, creating the label when the repository lacks
# it. An item from a repository that reads a GitHub Project is added to that Project
# if it isn't there yet, and its Status field is set. A pull request from a
# repository that reads its issues is refused: it has no Project to hold a Status.
# An Azure DevOps work item swaps its status-<name> tag in System.Tags and moves
# State only across state categories, from its type's states: entering any status
# after Queued moves a Proposed-category item to the first InProgress-category
# state, and List or Queued moves an InProgress-, Resolved- or Completed-category
# item to the first Proposed-category state. One JSON patch writes both, and fails
# if the item changed since it was read.
# Done is never stored: closing the issue, or completing the work item, makes it Done.
# Then asks each running local board to read the item's source now, as boards.sh says.
set -euo pipefail

usage="usage: status.sh <owner/repo#n | url | Azure work item url> <Status>"
ref=${1:?$usage}
status=${2:?$usage}

if [[ "$ref" =~ ^([^/#]+)/([^/#]+)#([0-9]+)$ ]]; then
    url="https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}/issues/${BASH_REMATCH[3]}"
else
    url=$ref
fi

# shellcheck source-path=SCRIPTDIR source=boards.sh
source "$(dirname "$0")/boards.sh"
# shellcheck source-path=SCRIPTDIR source=azure.sh
source "$(dirname "$0")/azure.sh"
if [[ $status == Done ]]; then
    if azure_work_item "$url"; then
        echo "Done isn't stored. Completing the work item makes it Done." >&2
    else
        echo "Done isn't stored. Closing the issue makes it Done." >&2
    fi
    exit 1
fi

# The statuses an item can carry, as in STATUSES in packages/shared/src/model.ts, less Done.
statuses=(List Queued Shaping "Needs you" Ready "In progress" Review Verify "Ready to merge")
label_of() { tr '[:upper:] ' '[:lower:]-' <<<"status-$1"; }

set_label() {
    local repo=$1 number=$2 label known=() current=() name lookup
    for name in "${statuses[@]}"; do
        known+=("$(label_of "$name")")
        if [[ $name == "$status" ]]; then label=$(label_of "$name"); fi
    done
    if [[ -z ${label:-} ]]; then
        echo "Unknown status \"$status\"." >&2
        exit 1
    fi
    while IFS= read -r name; do
        if [[ " ${known[*]} " == *" $name "* ]]; then current+=("$name"); fi
    done < <(gh issue view "$number" --repo "$repo" --json labels --jq '.labels[].name')
    if ((${#current[@]} > 1)); then
        echo "$url has ${#current[@]} status labels: ${current[*]}. Remove all but one, then rerun." >&2
        exit 1
    fi
    # Only GitHub's 404 means the label is missing; any other failure stops here.
    if ! lookup=$(gh api "repos/$repo/labels/$label" --silent 2>&1); then
        if [[ $lookup != *"HTTP 404"* ]]; then
            echo "Could not look up the $label label in $repo. $lookup" >&2
            exit 1
        fi
        gh label create "$label" --repo "$repo" --color EDEDED --description "Status: $status"
    fi
    local edit=(--add-label "$label")
    if [[ -n ${current[0]:-} && ${current[0]} != "$label" ]]; then
        edit+=(--remove-label "${current[0]}")
    fi
    gh issue edit "$number" --repo "$repo" "${edit[@]}" >/dev/null
}

set_field() {
    local owner=$1 project=$2 project_id field_id option_id item_id
    project_id=$(gh project view "$project" --owner "$owner" --format json --jq .id)
    read -r field_id option_id < <(gh project field-list "$project" --owner "$owner" --format json |
        jq -r --arg status "$status" '.fields[] | select(.name == "Status") | [.id, (.options[] | select(.name == $status) | .id)] | @tsv')
    if [[ -z "${option_id:-}" ]]; then
        echo "Unknown status \"$status\"." >&2
        exit 1
    fi
    item_id=$(gh project item-add "$project" --owner "$owner" --url "$url" --format json --jq .id)
    gh project item-edit --project-id "$project_id" --id "$item_id" --field-id "$field_id" --single-select-option-id "$option_id" >/dev/null
}

# set_tag: on the Azure work item in az_org and az_id, swaps the status tag and moves State as above.
set_tag() {
    local tag name known=() item tags current type state states category target=""
    for name in "${statuses[@]}"; do
        known+=("$(label_of "$name")")
        if [[ $name == "$status" ]]; then tag=$(label_of "$name"); fi
    done
    if [[ -z ${tag:-} ]]; then
        echo "Unknown status \"$status\"." >&2
        exit 1
    fi
    az_err=$(mktemp) az_patch=$(mktemp)
    trap 'rm -f "$az_err" "$az_patch"' EXIT
    if ! item=$(az boards work-item show --id "$az_id" --organization "$az_org" --output json 2>"$az_err"); then
        az_failure "Could not read $url" "$(cat "$az_err")" >&2
        exit 1
    fi
    # System.Tags is one string, "a; b", absent when the item has no tags.
    tags=$(jq -c '[.fields["System.Tags"] // "" | split(";")[] | gsub("^\\s+|\\s+$"; "") | select(. != "")]' <<<"$item")
    current=$(jq -r --arg known "${known[*]}" '[.[] | select(IN($known | split(" ")[]))] | join(" ")' <<<"$tags")
    if [[ $current == *" "* ]]; then
        echo "$url has $(wc -w <<<"$current" | tr -d ' ') status tags: $current. Remove all but one, then rerun." >&2
        exit 1
    fi
    if [[ -z $current ]] && (($(jq length <<<"$tags") >= 100)); then
        echo "$url has 100 tags, Azure's limit, so it can't take $tag. Remove a tag, then rerun." >&2
        exit 1
    fi
    type=$(jq -r '.fields["System.WorkItemType"]' <<<"$item")
    state=$(jq -r '.fields["System.State"]' <<<"$item")
    if ! states=$(az devops invoke --area wit --resource workitemtypestates --organization "$az_org" \
        --route-parameters "project=$(percent_decode "$az_project")" "type=$type" --api-version 7.1 --output json 2>"$az_err"); then
        az_failure "Could not read the states of $type in $(percent_decode "$az_project")" "$(cat "$az_err")" >&2
        exit 1
    fi
    category=$(jq -r --arg state "$state" 'first(.value[] | select(.name == $state) | .category) // ""' <<<"$states")
    if [[ $status == List || $status == Queued ]]; then
        [[ ! $category =~ ^(InProgress|Resolved|Completed)$ ]] || target=Proposed
    elif [[ $category == Proposed ]]; then
        target=InProgress
    fi
    if [[ -n $target ]]; then
        state=$(jq -r --arg category "$target" 'first(.value[] | select(.category == $category) | .name) // ""' <<<"$states")
        if [[ -z $state ]]; then
            echo "$type in $(percent_decode "$az_project") has no $target-category state to move $url to." >&2
            exit 1
        fi
        target=$state
    fi
    jq -n --argjson rev "$(jq '.rev' <<<"$item")" --argjson tags "$tags" --arg current "$current" --arg tag "$tag" --arg state "$target" '
        [{op: "test", path: "/rev", value: $rev},
         {op: "replace", path: "/fields/System.Tags", value: ([$tags[] | select(. != $current)] + [$tag] | join("; "))}]
        + if $state == "" then [] else [{op: "replace", path: "/fields/System.State", value: $state}] end' >"$az_patch"
    if ! az devops invoke --area wit --resource workitems --organization "$az_org" --route-parameters "id=$az_id" \
        --http-method PATCH --media-type application/json-patch+json --in-file "$az_patch" \
        --api-version 7.1 --output none 2>"$az_err"; then
        az_failure "Could not write $url" "$(cat "$az_err")" >&2
        exit 1
    fi
}

if azure_work_item "$url"; then
    set_tag
elif [[ $url =~ ^https://github\.com/([^/]+/[^/]+)/(issues|pull)/([0-9]+)$ ]]; then
    repo=${BASH_REMATCH[1]} kind=${BASH_REMATCH[2]} number=${BASH_REMATCH[3]}
    # repo-config.sh names its failure on stderr, which passes straight through.
    config=$(bash "$(dirname "$0")/repo-config.sh" "$repo")
    if [[ $(jq -r .itemSource.kind <<<"$config") == github-project ]]; then
        set_field "$(jq -r .itemSource.owner <<<"$config")" "$(jq -r .itemSource.number <<<"$config")"
    elif [[ $kind == issues ]]; then
        set_label "$repo" "$number"
    else
        echo "$repo reads its issues, not a Project, so its pull request $url has no Status to set." >&2
        exit 1
    fi
else
    echo "$usage" >&2
    exit 1
fi
echo "$url → $status"

ask_boards_to_read "$url"
