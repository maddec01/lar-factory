#!/bin/bash
# Usage: slice.sh <owner/repo> <parent number or URL> <title> <body-file>
# Creates a slice as a sub-issue of its build, then keeps it off the "Mux"
# project: GitHub auto-adds sub-issues of a build on the board a few seconds
# after creation, so it polls every SLICE_POLL_INTERVAL seconds (default 2) for
# SLICE_POLL_TIMEOUT seconds (default 20) and deletes any item that appears.
# Once it has deleted one, it stops at the first poll that finds none.
# Prints the slice's URL.
set -euo pipefail

# shellcheck source=project.sh
source "$(dirname "$0")/project.sh"
usage="usage: slice.sh <owner/repo> <parent number or URL> <title> <body-file>"
repo=${1:?$usage}
parent=${2:?$usage}
title=${3:?$usage}
body=${4:?$usage}
interval=${SLICE_POLL_INTERVAL:-2}
timeout=${SLICE_POLL_TIMEOUT:-20}

url=$(gh issue create --repo "$repo" --parent "$parent" --title "$title" --body-file "$body")

# From here on every failure names the slice, so nobody reruns and makes a duplicate.
ids=
stranded() {
    local what how
    if [[ -n "$ids" ]]; then
        what="couldn't remove it from the Mux board"
        how=$(for id in $ids; do printf '\n  gh project item-delete %s --owner %s --id %s' "$project" "$owner" "$id"; done)
    else
        what="it may be on the Mux board"
        how=$'\n'"  gh project item-list $project --owner $owner --limit 1000 --format json --jq '.items[] | select(.content.url == \"$url\") | .id'"
        how="$how"$'\n'"  then, if it prints an id: gh project item-delete $project --owner $owner --id <id>"
    fi
    echo "slice.sh: created $url but $what; don't rerun (that makes a duplicate). Check and remove it by hand:$how" >&2
}
trap 'status=$?; ((status == 0)) || stranded' EXIT

items() {
    gh api graphql -F url="$url" -f query='
        query($url: URI!) {
          resource(url: $url) {
            ... on Issue {
              projectItems(first: 20) {
                nodes { id project { number owner { ... on User { login } ... on Organization { login } } } }
              }
            }
          }
        }' --jq ".data.resource.projectItems.nodes[] | select(.project.number == $project and .project.owner.login == \"$owner\") | .id"
}

echo "slice.sh: created $url; watching up to ${timeout}s for the Mux board auto-add, to remove it…" >&2
deleted=
for ((poll = 0; ; poll++)); do
    ids=$(items)
    [[ -n "$ids" || -z "$deleted" ]] || break
    ((poll < timeout / interval)) || break
    for id in $ids; do
        gh project item-delete "$project" --owner "$owner" --id "$id" >/dev/null
        deleted=1
    done
    ids=
    sleep "$interval"
done

if [[ -n "$ids" ]]; then
    echo "slice.sh: $url is still on the Mux board after ${timeout}s." >&2
    exit 1
fi
echo "$url"
