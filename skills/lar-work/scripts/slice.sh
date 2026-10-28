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
# On Azure DevOps the parent is the build's work item URL, and the slice is a Task
# in the build's project, created with its parent link and a markdown description
# in one call. <owner/repo> is then the Azure repository, as repo-config.sh takes it.
# Once the slice is made, it asks each running local board to read the build's
# source, as boards.sh says, so the new slice shows on the build's card.
set -euo pipefail

usage="usage: slice.sh <owner/repo> <parent number or URL> <title> <body-file>"
repo=${1:?$usage}
parent=${2:?$usage}
title=${3:?$usage}
body=${4:?$usage}
interval=${SLICE_POLL_INTERVAL:-2}
timeout=${SLICE_POLL_TIMEOUT:-20}

# shellcheck source-path=SCRIPTDIR source=boards.sh
source "$(dirname "$0")/boards.sh"
# shellcheck source-path=SCRIPTDIR source=azure.sh
source "$(dirname "$0")/azure.sh"
if azure_work_item "$parent"; then
    patch=$(mktemp) err=$(mktemp)
    trap 'rm -f "$patch" "$err"' EXIT
    jq -n --arg title "$title" --rawfile body "$body" --arg parent "$az_org/_apis/wit/workItems/$az_id" '[
        {op: "add", path: "/fields/System.Title", value: $title},
        {op: "add", path: "/fields/System.Description", value: $body},
        {op: "add", path: "/multilineFieldsFormat/System.Description", value: "Markdown"},
        {op: "add", path: "/relations/-", value: {rel: "System.LinkTypes.Hierarchy-Reverse", url: $parent}}]' >"$patch"
    # The create endpoint is .../workitems/$<type>; az fills in the type. az reads the version as a number, so it
    # can't pass 7.2-preview.3, the first that takes a markdown description; given 7.2-preview, az adds the .3.
    if ! created=$(az devops invoke --area wit --resource workitems --organization "$az_org" \
        --route-parameters "project=$(percent_decode "$az_project")" type=Task \
        --http-method POST --media-type application/json-patch+json --in-file "$patch" \
        --api-version 7.2-preview --output json 2>"$err"); then
        echo "slice.sh: $(az_failure "could not create the slice under $parent" "$(cat "$err")")" >&2
        exit 1
    fi
    echo "$az_org/$az_project/_workitems/edit/$(jq -r .id <<<"$created")"
    ask_boards_to_read "$parent"
    exit 0
fi
if azure_repo "$repo"; then
    echo "slice.sh: on Azure DevOps the parent is the build's work item URL, not $parent." >&2
    exit 1
fi

build_repo=$repo
if [[ $parent =~ ^https://github\.com/([^/]+/[^/]+)/issues/[0-9]+$ ]]; then build_repo=${BASH_REMATCH[1]}; fi
# repo-config.sh names its failure on stderr, which passes straight through.
config=$(bash "$(dirname "$0")/repo-config.sh" "$build_repo")
parent_url=$parent
[[ $parent =~ ^[0-9]+$ ]] && parent_url="https://github.com/$build_repo/issues/$parent"

url=$(gh issue create --repo "$repo" --parent "$parent" --title "$title" --body-file "$body")

if [[ $(jq -r .itemSource.kind <<<"$config") != github-project ]]; then
    echo "$url"
    ask_boards_to_read "$parent_url"
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
ask_boards_to_read "$parent_url"
