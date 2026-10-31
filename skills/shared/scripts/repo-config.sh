#!/bin/bash
# Usage: repo-config.sh <owner/repo> | <Azure repository> | --list | --connections <repository>
# Reads only this machine's repository-settings.json. No provider CLI or checkout
# files are consulted. Settings live in each repository entry's settings.overrides;
# the name is retained for compatibility, with built-in defaults as the only fallback.
# The absolute LAR_FACTORY_DATA_DIR overrides ~/Library/Application Support/Lar Factory.
# --list prints the repositories array, or [] when no settings file exists.
# --connections prints listed repositories paired with the named repository.
set -euo pipefail

usage="usage: repo-config.sh <owner/repo> | <Azure repository> | --list | --connections <repository>"
# owner/name, each part of letters, digits, ".", "_" or "-", and neither "." nor "..". A jq regex: bash's has no lookahead.
repo_form='^(?!\.\.?/)[A-Za-z0-9._-]+/(?!\.\.?\z)[A-Za-z0-9._-]+\z'
# An Azure repository on the list: <org>/<project>/<repo> as its origin URL has them, each part as azure.sh's azure_repo
# takes it, and none "." nor "..".
azure_form='^(?!\.\.?/)[A-Za-z0-9._%~-]+/(?!\.\.?/)[A-Za-z0-9._%~-]+/(?!\.\.?\z)[A-Za-z0-9._%~-]+\z'
arg=${1:-}

data_dir="$HOME/Library/Application Support/Lar Factory"
[[ ${LAR_FACTORY_DATA_DIR:-} != /* ]] || data_dir=$LAR_FACTORY_DATA_DIR
list_file="$data_dir/repository-settings.json"
# list: prints the repositories array of list_file, [] when it is missing.
list() {
    local problem
    if [[ ! -e $list_file ]]; then
        echo '[]'
        return 0
    fi
    if ! jq empty "$list_file" 2>/dev/null; then
        echo "$list_file isn't valid JSON." >&2
        return 1
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
        return 1
    fi
    jq '.repositories' "$list_file"
}

if [[ $arg == --list ]]; then
    list
    exit 0
fi

if [[ $arg == --connections ]]; then
    repo=${2:-}
    if [[ -z $repo ]]; then
        echo "$usage" >&2
        exit 1
    fi
    repositories=$(list)
    if ! jq -e --arg repo "$repo" 'any(.[]; .repo | ascii_downcase == ($repo | ascii_downcase))' <<<"$repositories" >/dev/null; then
        echo "$repo isn't onboarded." >&2
        exit 1
    fi
    jq --arg repo "$repo" --argjson repos "$repositories" '
        def listed($name): first($repos[] | .repo | select(ascii_downcase == ($name | ascii_downcase))) // null;
        [(.connections // []) | if type == "array" then .[] else empty end
            | select(type == "array" and length == 2 and all(.[]; type == "string"))
            | map(listed(.)) | select(all(.[]; . != null) and (.[0] | ascii_downcase) != (.[1] | ascii_downcase))
            | if (.[0] | ascii_downcase) == ($repo | ascii_downcase) then .[1]
              elif (.[1] | ascii_downcase) == ($repo | ascii_downcase) then .[0] else empty end]
        | unique_by(ascii_downcase) as $found | [$repos[] | .repo | select(IN($found[]))]' "$list_file"
    exit 0
fi

# Parse repository identity locally. azure.sh's parsers make no provider calls.
if jq -en --arg repo "$arg" --arg repo_form "$repo_form" '$repo | test($repo_form)' >/dev/null; then
    provider=github repo=$arg
else
    # shellcheck source-path=SCRIPTDIR source=azure.sh
    source "$(dirname "$0")/azure.sh"
    if ! azure_repo "$arg"; then
        echo "$usage" >&2
        exit 1
    fi
    provider=azure repo="${az_org##*/}/$az_project/$az_repo"
fi
repositories=$(list)
entry=$(jq --arg repo "$repo" 'first(.[] | select(.repo | ascii_downcase == ($repo | ascii_downcase))) // null' <<<"$repositories")
if [[ $entry == null ]]; then
    echo "$repo isn't onboarded on this machine. Add it in Settings > Repositories." >&2
    exit 1
fi
local_settings=$(jq '.settings // {}' <<<"$entry")
problem=$(jq -r --arg provider "$provider" '
    if type != "object" then "settings must be an object"
    elif has("overrides") and (.overrides | type) != "object" then "settings.overrides must be an object"
    elif has("structureSync") and (.structureSync | type) != "boolean" then "structureSync must be a boolean"
    else (.overrides // {}) |
        if has("role") and (.role | type) != "string" then "role must be a string"
        elif has("itemSource") and (.itemSource | type) != "object" then "itemSource must be an object"
        elif has("itemSource") and (($provider == "github" and .itemSource.kind != "issues")
            or ($provider == "azure" and (.itemSource.kind != "azure-board" or (.itemSource.team | type) != "string" or .itemSource.team == ""))) then "itemSource must name this provider and its Azure team when applicable"
        elif has("labels") and ((.labels | type) != "array" or any(.labels[]; type != "string")) then "labels must be an array of strings"
        elif has("skills") and ((.skills | type) != "array" or any(.skills[]; type != "string")) then "skills must be an array of strings"
        elif has("domainDocs") and (.domainDocs | type != "object" or (.kind != "private" and (.kind != "repository" or (.glossary | type) != "string" or (.adrs | type) != "string"))) then "domainDocs must be private or name repository glossary and adrs paths"
        else empty end
    end' <<<"$local_settings")
if [[ -n $problem ]]; then
    echo "$list_file: $repo: $problem." >&2
    exit 1
fi
# structureSync defaults to ON unless this machine explicitly disables it.
jq --arg provider "$provider" '
    . as $local | (.overrides // {}) as $settings |
    ($local.structureSync != false) as $sync |
    {version: 1, role: "", itemSource: (if $provider == "azure" then null else {kind: "issues"} end),
        labels: [], domainDocs: {kind: "private"}, skills: []}
    + ($settings | with_entries(select(.key | IN("role", "itemSource", "labels", "domainDocs", "skills", "vocabulary"))))
    + {structureSync: $sync}' <<<"$local_settings"
