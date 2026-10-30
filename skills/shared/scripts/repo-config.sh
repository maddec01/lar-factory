#!/bin/bash
# Usage: repo-config.sh <owner/repo> | <Azure repository> | --list
# <owner/repo> prints the GitHub repository's Repository config: .lar-factory.json
# read from its default branch with gh, never from a checkout, with defaults filled
# in (version 1, itemSource {"kind": "issues"}, show "all", labels []). role has no default.
# An Azure repository is its origin URL or <org>/<project>/<repo>; its file is read
# with az the same way. Its itemSource names the team’s backlog and current sprint
# together: {"kind": "azure-board", "team": ...}.
# --list prints the onboarded repositories, the repositories array of
# ~/Library/Application Support/Lar Factory/repositories.json, the file the board
# server reads. A missing file means none: []. It leaves out each entry still
# resetting, so lar-work never reads a repository being reset as onboarded.
# Each error exits nonzero with its reason on stderr.
set -euo pipefail

usage="usage: repo-config.sh <owner/repo> | <Azure repository> | --list"
# owner/name, each part of letters, digits, ".", "_" or "-", and neither "." nor "..". A jq regex: bash's has no lookahead.
repo_form='^(?!\.\.?/)[A-Za-z0-9._-]+/(?!\.\.?\z)[A-Za-z0-9._-]+\z'
# An Azure repository on the list: <org>/<project>/<repo> as its origin URL has them, each part as azure.sh's azure_repo
# takes it, and none "." nor "..".
azure_form='^(?!\.\.?/)[A-Za-z0-9._%~-]+/(?!\.\.?/)[A-Za-z0-9._%~-]+/(?!\.\.?\z)[A-Za-z0-9._%~-]+\z'
arg=${1:-}

if [[ $arg == --list ]]; then
    list_file="$HOME/Library/Application Support/Lar Factory/repositories.json"
    if [[ ! -e $list_file ]]; then
        echo '[]'
        exit 0
    fi
    if ! jq empty "$list_file" 2>/dev/null; then
        echo "$list_file isn't valid JSON." >&2
        exit 1
    fi
    problem=$(jq -r '
        if type != "object" or (.repositories | type) != "array" then
            "expected an object with a repositories array, like {\"repositories\": [{\"repo\": \"owner/name\"}]}"
        else
            first(.repositories | to_entries[]
                | select((.value | type) != "object" or (.value.repo | type) != "string"
                    or (.value.repo | test($repo_form) or test($azure_form) | not))
                | "repositories[\(.key)] needs a repo of the form owner/name") // empty
        end' --arg repo_form "$repo_form" --arg azure_form "$azure_form" "$list_file")
    if [[ -n $problem ]]; then
        echo "$list_file: $problem." >&2
        exit 1
    fi
    jq '[.repositories[] | select(has("resetting") | not)]' "$list_file"
    exit 0
fi

err=$(mktemp)
trap 'rm -f "$err"' EXIT
read_status=0
if jq -en --arg repo "$arg" --arg repo_form "$repo_form" '$repo | test($repo_form)' >/dev/null; then
    provider=github repo=$arg
    # Without ref, the contents API reads the default branch.
    raw=$(gh api -H "Accept: application/vnd.github.raw" "repos/$repo/contents/.lar-factory.json" 2>"$err") || read_status=$?
    if ((read_status != 0)); then
        if [[ $read_status == 4 || $(cat "$err") == *"gh auth login"* ]]; then
            echo "gh is logged out. Run gh auth login, then rerun." >&2
        elif [[ $(cat "$err") == *"HTTP 404"* ]]; then
            echo "$repo: no .lar-factory.json on its default branch." >&2
        else
            echo "$repo: could not read .lar-factory.json. $(cat "$err")" >&2
        fi
        exit 1
    fi
else
    # shellcheck source-path=SCRIPTDIR source=azure.sh
    source "$(dirname "$0")/azure.sh"
    if ! azure_repo "$arg"; then
        echo "$usage" >&2
        exit 1
    fi
    provider=azure repo="${az_org##*/}/$az_project/$az_repo"
    # Without versionDescriptor, the items API reads the default branch.
    raw=$(az devops invoke --area git --resource items --organization "$az_org" \
        --route-parameters "project=$(percent_decode "$az_project")" "repositoryId=$(percent_decode "$az_repo")" \
        --query-parameters path=/.lar-factory.json includeContent=true \
        --api-version 7.1 --output json 2>"$err") || read_status=$?
    if ((read_status != 0)); then
        # TF401174 is Azure's "item could not be found".
        if [[ $(cat "$err") == *TF401174* ]]; then
            echo "$repo: no .lar-factory.json on its default branch." >&2
        else
            echo "$repo: $(az_failure "could not read .lar-factory.json" "$(cat "$err")")" >&2
        fi
        exit 1
    fi
    if ! raw=$(jq -er '.content | strings' <<<"$raw" 2>/dev/null); then
        echo "$repo: could not read .lar-factory.json. az returned no file content." >&2
        exit 1
    fi
fi

if ! jq empty <<<"$raw" 2>/dev/null; then
    echo "$repo: .lar-factory.json isn't valid JSON." >&2
    exit 1
fi
problem=$(jq -r '
    if type != "object" then "isn'"'"'t a JSON object"
    elif has("version") and (.version | type) != "number" then "field version must be a number"
    elif (.role | type) != "string" or .role == "" then "field role is missing or not a string"
    elif has("itemSource") and (.itemSource | type) != "object" then "field itemSource must be an object"
    elif ($provider == "github" and has("itemSource") and .itemSource.kind != "issues")
        or ($provider == "azure" and .itemSource.kind != "azure-board") then
        "has an unsupported item source. Run onboarding again"
    elif $provider == "azure" and ((.itemSource.team | type) != "string" or .itemSource.team == "") then
        "field itemSource.team must name the team for an azure-board"
    elif has("show") and (.show | IN("all", "opted-in") | not) then "field show must be \"all\" or \"opted-in\""
    elif has("labels") and ((.labels | type) != "array" or any(.labels[]; type != "string")) then
        "field labels must be an array of strings"
    else empty end' --arg provider "$provider" <<<"$raw")
if [[ -n $problem ]]; then
    echo "$repo: .lar-factory.json $problem." >&2
    exit 1
fi
jq '{version: 1, role: .role, itemSource: {kind: "issues"}, show: "all", labels: []} + .' <<<"$raw"
