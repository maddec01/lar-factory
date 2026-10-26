#!/bin/bash
# Usage: slice.sh <owner/repo> <parent number or URL> <title> <body-file>
# Creates a slice as a sub-issue of its build and prints the slice's URL. The
# build's repository is the parent URL's, else <owner/repo>. When that
# repository's config from repo-config.sh reads a GitHub Project, it keeps the
# slice off that Project: GitHub auto-adds sub-issues of a build on the Project a
# few seconds after creation, so it polls every SLICE_POLL_INTERVAL seconds
# (default 2) for SLICE_POLL_TIMEOUT seconds (default 20) and deletes any item
# that appears. Once it has deleted one, it stops at the first poll that finds none.
# A repository that reads its issues has no Project, so there is nothing to poll.
set -euo pipefail

usage="usage: slice.sh <owner/repo> <parent number or URL> <title> <body-file>"
repo=${1:?$usage}
parent=${2:?$usage}
title=${3:?$usage}
body=${4:?$usage}
interval=${SLICE_POLL_INTERVAL:-2}
timeout=${SLICE_POLL_TIMEOUT:-20}

build_repo=$repo
if [[ $parent =~ ^https://github\.com/([^/]+/[^/]+)/issues/[0-9]+$ ]]; then build_repo=${BASH_REMATCH[1]}; fi
# repo-config.sh names its failure on stderr, which passes straight through.
config=$(bash "$(dirname "$0")/repo-config.sh" "$build_repo")

url=$(gh issue create --repo "$repo" --parent "$parent" --title "$title" --body-file "$body")

if [[ $(jq -r .itemSource.kind <<<"$config") != github-project ]]; then
    echo "$url"
    exit 0
fi
owner=$(jq -r .itemSource.owner <<<"$config")
project=$(jq -r .itemSource.number <<<"$config")
board="Project $project of $owner"

# From here on every failure names the slice, so nobody reruns and makes a duplicate.
ids=
stranded() {
    local what how
    if [[ -n "$ids" ]]; then
        what="couldn't remove it from $board"
        how=$(for id in $ids; do printf '\n  gh project item-delete %s --owner %s --id %s' "$project" "$owner" "$id"; done)
    else
        what="it may be on $board"
        how=$'\n'"  gh project item-list $project --owner $owner --limit 1000 --format json --jq '.items[] | select(.content.url == \"$url\") | .id'"
        how="$how"$'\n'"  then, if it prints an id: gh project item-delete $project --owner $owner --id <id>"
    fi
    echo "slice.sh: created $url but $what; don't rerun (that makes a duplicate). Check and remove it by hand:$how" >&2
}
trap 'status=$?; ((status == 0)) || stranded' EXIT

items() {
    # shellcheck disable=SC2016 # $url, $number and $owner are GraphQL and jq variables, not shell ones
    gh api graphql -F url="$url" -f query='
        query($url: URI!) {
          resource(url: $url) {
            ... on Issue {
              projectItems(first: 20) {
                nodes { id project { number owner { ... on User { login } ... on Organization { login } } } }
              }
            }
          }
        }' | jq -r --argjson number "$project" --arg owner "$owner" \
        '.data.resource.projectItems.nodes[] | select(.project.number == $number and .project.owner.login == $owner) | .id'
}

echo "slice.sh: created $url; watching up to ${timeout}s for the auto-add to $board, to remove it…" >&2
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
    echo "slice.sh: $url is still on $board after ${timeout}s." >&2
    exit 1
fi
echo "$url"
