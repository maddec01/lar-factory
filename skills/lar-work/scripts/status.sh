#!/bin/bash
# Usage: status.sh <owner/repo#number | issue or PR URL> <Status>
# Adds the item to the "lar" project if it isn't there yet, then sets its Status.
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

project_id=$(gh project view "$project" --owner "$owner" --format json --jq .id)
read -r field_id option_id < <(gh project field-list "$project" --owner "$owner" --format json |
    jq -r --arg status "$status" '.fields[] | select(.name == "Status") | [.id, (.options[] | select(.name == $status) | .id)] | @tsv')
if [[ -z "${option_id:-}" ]]; then
    echo "Unknown status \"$status\"." >&2
    exit 1
fi

item_id=$(gh project item-add "$project" --owner "$owner" --url "$url" --format json --jq .id)
gh project item-edit --project-id "$project_id" --id "$item_id" --field-id "$field_id" --single-select-option-id "$option_id" >/dev/null
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
