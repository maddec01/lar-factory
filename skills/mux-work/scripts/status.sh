#!/bin/bash
# Usage: status.sh <owner/repo#number | issue or PR URL> <Status>
# Adds the item to the "Mux" project if it isn't there yet, then sets its Status.
# Then asks the local board (port MUX_BOARD_PORT, default 4317) to read GitHub now.
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

# The status is set; the board's answer, or no board at all, changes nothing.
port=${MUX_BOARD_PORT:-}
[[ $port =~ ^[0-9]+$ ]] || port=4317
board="127.0.0.1:$port"
curl --silent --output /dev/null --max-time 1 --request POST --header 'Content-Type: application/json' \
    --header "Origin: http://$board" --data '{}' "http://$board/api/read" || true
