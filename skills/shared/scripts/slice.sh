#!/bin/bash
# Usage: slice.sh <owner/repo> <parent number or URL> <title> <body-file>
# Creates a slice as a sub-issue of its build and prints the slice's URL. The
# build's repository is the parent URL's, else <owner/repo>. The board displays
# slices inside their build's card.
# On Azure DevOps the parent is the build's work item URL, and the slice is a Task
# in the build's project, created with its parent link and a markdown description
# in one call. It sets no tags: slices stay off the board, while callers creating
# a decision or build add decision-* or build afterward. <owner/repo> is then
# the Azure repository, as repo-config.sh takes it.
# Once the slice is made, it asks each running local board to read the build's
# source, as boards.sh says, so the new slice shows on the build's card.
set -euo pipefail

usage="usage: slice.sh <owner/repo> <parent number or URL> <title> <body-file>"
repo=${1:?$usage}
parent=${2:?$usage}
title=${3:?$usage}
body=${4:?$usage}

# shellcheck source-path=SCRIPTDIR source=boards.sh
source "$(dirname "$0")/boards.sh"
# shellcheck source-path=SCRIPTDIR source=azure.sh
source "$(dirname "$0")/azure.sh"
if azure_work_item "$parent"; then
    patch=$(mktemp) err=$(mktemp)
    trap 'rm -f "$patch" "$err"' EXIT
    # Keep slices, decisions and builds in their parent's team and iteration, including backlog work.
    if ! placement=$(az boards work-item show --id "$az_id" --organization "$az_org" --output json 2>"$err"); then
        echo "slice.sh: $(az_failure "could not read the build's area and iteration" "$(cat "$err")")" >&2
        exit 1
    fi
    if ! jq -e '.fields | [."System.AreaPath", ."System.IterationPath"] | all(.[]; type == "string" and length > 0)' <<<"$placement" >/dev/null; then
        echo "slice.sh: the build has no area or iteration. Check it in Azure DevOps before creating a slice." >&2
        exit 1
    fi
    jq -n --argjson placement "$placement" --arg title "$title" --rawfile body "$body" --arg parent "$az_org/_apis/wit/workItems/$az_id" '[
        {op: "add", path: "/fields/System.AreaPath", value: $placement.fields["System.AreaPath"]},
        {op: "add", path: "/fields/System.IterationPath", value: $placement.fields["System.IterationPath"]},
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
bash "$(dirname "$0")/repo-config.sh" "$build_repo" >/dev/null
parent_url=$parent
[[ $parent =~ ^[0-9]+$ ]] && parent_url="https://github.com/$build_repo/issues/$parent"

url=$(gh issue create --repo "$repo" --parent "$parent" --title "$title" --body-file "$body")

echo "$url"
ask_boards_to_read "$parent_url"
