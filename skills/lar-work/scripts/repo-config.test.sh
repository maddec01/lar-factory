#!/usr/bin/env bash
# Tests repo-config.sh's two forms against a fake gh and a temporary HOME. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo_config_sh="$here/repo-config.sh"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# A fake gh that answers only the raw read of .lar-factory.json from the default
# branch. It prints the file "$FAKE_FILES/<owner>/<name>", or GitHub's 404 when
# that file is missing. With FAKE_LOGGED_OUT set it fails as a logged-out gh does.
bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT
export FAKE_FILES="$bin/files"
cat >"$bin/gh" <<'GH'
#!/bin/bash
if [[ -n ${FAKE_LOGGED_OUT:-} ]]; then
    printf 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n' >&2
    exit 4
fi
if [[ "$*" =~ ^api\ -H\ Accept:\ application/vnd\.github\.raw\ repos/([^/]+)/([^/]+)/contents/\.lar-factory\.json$ ]]; then
    file="$FAKE_FILES/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    if [[ -f $file ]]; then cat "$file"; exit 0; fi
    echo '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/contents#get-repository-content","status":"404"}'
    echo 'gh: Not Found (HTTP 404)' >&2
    exit 1
fi
echo "fake gh: unexpected $*" >&2
exit 1
GH
chmod +x "$bin/gh"
export PATH="$bin:$PATH" HOME="$bin/home"
data="$HOME/Library/Application Support/Lar Factory"
list_file="$data/repositories.json"

# file <owner/name> <json>: puts .lar-factory.json on that repository's default branch.
file() { mkdir -p "$FAKE_FILES/${1%/*}"; printf '%s' "$2" >"$FAKE_FILES/$1"; }
# run <args>: runs repo-config.sh, sets $output, $errors and $status.
run() {
    status=0
    output=$(bash "$repo_config_sh" "$@" 2>"$bin/err") || status=$?
    errors=$(cat "$bin/err")
}
# check <name> <expected JSON>: passes when the run succeeded and printed that JSON.
check() {
    if ((status == 0)) && [[ -z $errors ]] && jq -e --argjson want "$2" '. == $want' <<<"$output" >/dev/null 2>&1; then
        pass "$1"
    else
        fail "$1: $status $output / $errors"
    fi
}
# refuses <name> <text>: passes when the run failed, printed nothing and named the text on stderr.
refuses() {
    if ((status != 0)) && [[ -z $output && $errors == *"$2"* ]]; then
        pass "$1"
    else
        fail "$1: $status $output / $errors"
    fi
}

# --list

run --list
check "with no repositories.json, --list prints []" '[]'

mkdir -p "$data"
echo '{"repositories":[{"repo":"maddec01/lar-factory"},{"repo":"maddec01/lar-server","onboarding":{"step":"setup","done":["project"],"answers":{"projectId":"lar-server"}}}]}' >"$list_file"
run --list
check "--list prints the repositories array, an entry still onboarding with its progress" '[{"repo":"maddec01/lar-factory"},{"repo":"maddec01/lar-server","onboarding":{"step":"setup","done":["project"],"answers":{"projectId":"lar-server"}}}]'

FAKE_LOGGED_OUT=1 run --list
check "--list doesn't need gh" '[{"repo":"maddec01/lar-factory"},{"repo":"maddec01/lar-server","onboarding":{"step":"setup","done":["project"],"answers":{"projectId":"lar-server"}}}]'

echo '{"repositories": [' >"$list_file"
run --list
refuses "a repositories.json that isn't JSON names the file" "$list_file isn't valid JSON"

echo '[]' >"$list_file"
run --list
refuses "a repositories.json that isn't an object names the file and the problem" "$list_file: expected an object with a repositories array"

echo '{"repositories":{}}' >"$list_file"
run --list
refuses "a repositories that isn't an array names the file and the problem" "$list_file: expected an object with a repositories array"

echo '{"repositories":[{"repo":"maddec01/lar-factory"},"maddec01/lar-server"]}' >"$list_file"
run --list
refuses "an entry that isn't an object names the file and the entry" "$list_file: repositories[1] needs a repo of the form owner/name"

echo '{"repositories":[{"repo":"lar-server"}]}' >"$list_file"
run --list
refuses "an entry without owner/name names the file and the entry" "$list_file: repositories[0] needs a repo of the form owner/name"

echo '{"repositories":[{"repo":"maddec01/.."}]}' >"$list_file"
run --list
refuses "an entry whose name is .. names the file and the entry" "$list_file: repositories[0] needs a repo of the form owner/name"

echo '{"repositories":[{"repo":"maddec01/lar?x"}]}' >"$list_file"
run --list
refuses "an entry with a ? in its name names the file and the entry" "$list_file: repositories[0] needs a repo of the form owner/name"

printf '%s' '{"repositories":[{"repo":"maddec01/lar-server\n"}]}' >"$list_file"
run --list
refuses "an entry ending in a newline names the file and the entry" "$list_file: repositories[0] needs a repo of the form owner/name"

# <owner/repo>

file maddec01/lar-factory '{"role":"factory"}'
run maddec01/lar-factory
check "fills in the defaults" '{"version":1,"role":"factory","itemSource":{"kind":"issues"},"show":"all","labels":[]}'

file maddec01/lar-server '{"version":1,"role":"server","itemSource":{"kind":"github-project","owner":"maddec01","number":3},"show":"opted-in","labels":["area-api"]}'
run maddec01/lar-server
check "keeps the fields the file sets" '{"version":1,"role":"server","itemSource":{"kind":"github-project","owner":"maddec01","number":3},"show":"opted-in","labels":["area-api"]}'

run maddec01/lar-apple
refuses "a 404 names the repository and the missing file" "maddec01/lar-apple: no .lar-factory.json on its default branch"

file maddec01/broken '{"role": '
run maddec01/broken
refuses "a file that doesn't parse names the repository" "maddec01/broken: .lar-factory.json isn't valid JSON"

file maddec01/broken '["factory"]'
run maddec01/broken
refuses "a file that isn't an object names the repository" "maddec01/broken: .lar-factory.json isn't a JSON object"

file maddec01/broken '{"show":"all"}'
run maddec01/broken
refuses "a file without role names the repository and role" "maddec01/broken: .lar-factory.json field role"

file maddec01/broken '{"role":"factory","itemSource":{"kind":"azure-boards"}}'
run maddec01/broken
refuses "an unknown item source kind names itemSource.kind" "maddec01/broken: .lar-factory.json field itemSource.kind"

file maddec01/broken '{"role":"factory","itemSource":{"kind":"github-project","number":3}}'
run maddec01/broken
refuses "a github-project without owner names itemSource.owner" "maddec01/broken: .lar-factory.json field itemSource.owner"

file maddec01/broken '{"role":"factory","itemSource":{"kind":"github-project","owner":"maddec01"}}'
run maddec01/broken
refuses "a github-project without number names itemSource.number" "maddec01/broken: .lar-factory.json field itemSource.number"

file maddec01/broken '{"role":"factory","itemSource":{"kind":"github-project","owner":"lar\" or true or \"","number":3}}'
run maddec01/broken
refuses "a github-project owner that isn't a GitHub login names itemSource.owner" "maddec01/broken: .lar-factory.json field itemSource.owner must be a GitHub login"

file maddec01/broken '{"role":"factory","itemSource":{"kind":"github-project","owner":"maddec01\n","number":3}}'
run maddec01/broken
refuses "a github-project owner ending in a newline names itemSource.owner" "maddec01/broken: .lar-factory.json field itemSource.owner must be a GitHub login"

file maddec01/broken '{"role":"factory","itemSource":{"kind":"github-project","owner":"maddec01","number":1.5}}'
run maddec01/broken
refuses "a github-project number that isn't a positive whole number names itemSource.number" "maddec01/broken: .lar-factory.json field itemSource.number must be a positive whole number"

file maddec01/broken '{"role":"factory","itemSource":{"kind":"github-project","owner":"maddec01","number":0}}'
run maddec01/broken
refuses "a github-project number of 0 names itemSource.number" "maddec01/broken: .lar-factory.json field itemSource.number must be a positive whole number"

file maddec01/broken '{"role":"factory","show":"some"}'
run maddec01/broken
refuses "a show other than all or opted-in names show" "maddec01/broken: .lar-factory.json field show"

file maddec01/broken '{"role":"factory","labels":"area-api"}'
run maddec01/broken
refuses "labels that aren't an array of strings names labels" "maddec01/broken: .lar-factory.json field labels"

file maddec01/broken '{"version":"1","role":"factory"}'
run maddec01/broken
refuses "a version that isn't a number names version" "maddec01/broken: .lar-factory.json field version"

FAKE_LOGGED_OUT=1 run maddec01/lar-factory
refuses "with gh logged out, says to run gh auth login" "gh auth login"

run lar-factory
refuses "a repository not of the form owner/name shows the usage" "usage: repo-config.sh"

for bad in ../lar-factory maddec01/.. maddec01/. 'maddec01/lar?x' 'maddec01/lar#x' $'maddec01/lar-factory\n'; do
    run "$bad"
    refuses "a repository $bad shows the usage" "usage: repo-config.sh"
done

run
refuses "no argument shows the usage" "usage: repo-config.sh"

((failures == 0))
