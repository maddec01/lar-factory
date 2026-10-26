#!/bin/bash
# Usage: status.sh <owner/repo#number | issue or PR URL> <Status>
# Sets the item's Status on the item. An issue from a repository whose config.json
# entry on lar-factory's main has "items": "issues" swaps its status-<name> label
# for the new one, creating the label when the repository lacks it. Any other item
# is added to the "lar" project if it isn't there yet, and its Status field is set.
# Done is never stored: closing the issue makes it Done.
# Then asks each running local board to read GitHub now: the one on LAR_BOARD_PORT when
# that is set, else every board recorded in ~/Library/Application Support/Lar Factory/boards.
set -euo pipefail

# shellcheck source=project.sh
source "$(dirname "$0")/project.sh"
ref=${1:?usage: status.sh <owner/repo#n | url> <Status>}
status=${2:?usage: status.sh <owner/repo#n | url> <Status>}

if [[ "$ref" =~ ^([^/#]+)/([^/#]+)#([0-9]+)$ ]]; then
    url="https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}/issues/${BASH_REMATCH[3]}"
else
    url=$ref
fi

if [[ $status == Done ]]; then
    echo "Done isn't stored. Closing the issue makes it Done." >&2
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
    local project_id field_id option_id item_id
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

items=
if [[ $url =~ ^https://github\.com/([^/]+/[^/]+)/issues/([0-9]+)$ ]]; then
    repo=${BASH_REMATCH[1]} number=${BASH_REMATCH[2]}
    items=$(gh api -H "Accept: application/vnd.github.raw" "repos/maddec01/lar-factory/contents/config.json?ref=main" |
        jq -r --arg repo "$repo" '.repos[] | select((.repo | ascii_downcase) == ($repo | ascii_downcase)) | .items // empty')
fi
if [[ $items == issues ]]; then
    set_label "$repo" "$number"
else
    set_field
fi
echo "$url → $status"

# The status is set; the boards' answers, or no board at all, change nothing.
read_board() {
    curl --silent --output /dev/null --max-time 1 --request POST --header 'Content-Type: application/json' \
        --header "Origin: http://127.0.0.1:$1" --data '{}' "http://127.0.0.1:$1/api/read" || true
}
if [[ ${LAR_BOARD_PORT:-} =~ ^[0-9]+$ ]]; then
    read_board "$LAR_BOARD_PORT"
    exit 0
fi
# Each live board records its port in <pid>.json. A record whose process is gone,
# or whose port no longer answers /healthz, is left over from a board that died.
for record in "$HOME/Library/Application Support/Lar Factory/boards/"*.json; do
    [[ -f $record ]] || continue
    pid=$(basename "$record" .json)
    port=$(jq -r '.port' "$record" 2>/dev/null || true)
    [[ $pid =~ ^[0-9]+$ && $port =~ ^[0-9]+$ ]] || continue
    kill -0 "$pid" 2>/dev/null || continue
    if curl --silent --fail --output /dev/null --max-time 1 "http://127.0.0.1:$port/healthz"; then
        read_board "$port"
    fi
done
