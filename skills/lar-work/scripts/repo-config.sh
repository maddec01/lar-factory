#!/bin/bash
# Usage: repo-config.sh <owner/repo> | --list
# <owner/repo> prints the repository's Repository config: .lar-factory.json read
# from its default branch with gh, never from a checkout, with defaults filled in
# (version 1, itemSource {"kind": "issues"}, show "all", labels []). role has no default.
# --list prints the onboarded repositories, the repositories array of
# ~/Library/Application Support/Lar Factory/repositories.json, the file the board
# server reads. A missing file means none: []. It leaves out each entry still
# resetting, so lar-work never reads a repository being reset as onboarded.
# Each error exits nonzero with its reason on stderr.
set -euo pipefail

usage="usage: repo-config.sh <owner/repo> | --list"
# owner/name, each part of letters, digits, ".", "_" or "-", and neither "." nor "..". A jq regex: bash's has no lookahead.
repo_form='^(?!\.\.?/)[A-Za-z0-9._-]+/(?!\.\.?\z)[A-Za-z0-9._-]+\z'
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
                    or (.value.repo | test($repo_form) | not))
                | "repositories[\(.key)] needs a repo of the form owner/name") // empty
        end' --arg repo_form "$repo_form" "$list_file")
    if [[ -n $problem ]]; then
        echo "$list_file: $problem." >&2
        exit 1
    fi
    jq '[.repositories[] | select(has("resetting") | not)]' "$list_file"
    exit 0
fi

if ! jq -en --arg repo "$arg" --arg repo_form "$repo_form" '$repo | test($repo_form)' >/dev/null; then
    echo "$usage" >&2
    exit 1
fi
repo=$arg

# Without ref, the contents API reads the default branch.
err=$(mktemp)
trap 'rm -f "$err"' EXIT
gh_status=0
raw=$(gh api -H "Accept: application/vnd.github.raw" "repos/$repo/contents/.lar-factory.json" 2>"$err") || gh_status=$?
if ((gh_status != 0)); then
    if [[ $gh_status == 4 || $(cat "$err") == *"gh auth login"* ]]; then
        echo "gh is logged out. Run gh auth login, then rerun." >&2
    elif [[ $(cat "$err") == *"HTTP 404"* ]]; then
        echo "$repo: no .lar-factory.json on its default branch." >&2
    else
        echo "$repo: could not read .lar-factory.json. $(cat "$err")" >&2
    fi
    exit 1
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
    elif has("itemSource") and (.itemSource.kind | IN("issues", "github-project") | not) then
        "field itemSource.kind must be \"issues\" or \"github-project\""
    elif .itemSource.kind == "github-project"
        and ((.itemSource.owner | type) != "string" or (.itemSource.owner | test("^[A-Za-z0-9](-?[A-Za-z0-9])*\\z") | not)) then
        "field itemSource.owner must be a GitHub login for a github-project"
    elif .itemSource.kind == "github-project"
        and ((.itemSource.number | type) != "number" or .itemSource.number < 1 or .itemSource.number != (.itemSource.number | floor)) then
        "field itemSource.number must be a positive whole number for a github-project"
    elif has("show") and (.show | IN("all", "opted-in") | not) then "field show must be \"all\" or \"opted-in\""
    elif has("labels") and ((.labels | type) != "array" or any(.labels[]; type != "string")) then
        "field labels must be an array of strings"
    else empty end' <<<"$raw")
if [[ -n $problem ]]; then
    echo "$repo: .lar-factory.json $problem." >&2
    exit 1
fi
jq '{version: 1, role: .role, itemSource: {kind: "issues"}, show: "all", labels: []} + .' <<<"$raw"
