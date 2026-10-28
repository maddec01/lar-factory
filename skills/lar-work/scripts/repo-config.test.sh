#!/usr/bin/env bash
# Tests repo-config.sh's forms against a fake gh, a fake az and a temporary HOME. No network.
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
trap 'for kind in github-project azure-sprint azure-backlog unknown; do
    for repo in maddec01/broken contoso/Fabrikam/broken; do
        file "$repo" "{\"role\":\"web\",\"itemSource\":{\"kind\":\"$kind\",\"team\":\"Team\"}}"
        run "$repo"
        refuses "removed or unknown $kind asks for onboarding on $repo" "$repo: .lar-factory.json has an unsupported item source. Run onboarding again."
    done
done

rm -rf "$bin"' EXIT
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
# A fake az that answers only the git items read of .lar-factory.json, without a
# version, so from the default branch. It logs its arguments to $FAKE_AZ_LOG and
# prints the item with the file "$FAKE_FILES/<org>/<project>/<repo>" as its
# content, or Azure's TF401174 when that file is missing. With FAKE_LOGGED_OUT set
# it fails as a logged-out az does, and with FAKE_NO_EXTENSION as one without the
# azure-devops extension.
cat >"$bin/az" <<'AZ'
#!/bin/bash
printf '%s\n' "$*" >>"$FAKE_AZ_LOG"
if [[ -n ${FAKE_NO_EXTENSION:-} ]]; then
    echo "ERROR: 'devops' is misspelled or not recognized by the system." >&2
    exit 2
fi
if [[ -n ${FAKE_LOGGED_OUT:-} ]]; then
    echo "ERROR: Before you can run Azure DevOps commands, you need to run the login command (az login if using AAD/MSA identity else az devops login if using PAT token) to setup credentials." >&2
    exit 1
fi
pattern='^devops invoke --area git --resource items --organization https://dev\.azure\.com/([^ ]+) --route-parameters project=(.+) repositoryId=([^ ]+) --query-parameters path=/\.lar-factory\.json includeContent=true --api-version 7\.1 --output json$'
if [[ "$*" =~ $pattern ]]; then
    file="$FAKE_FILES/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}/${BASH_REMATCH[3]}"
    if [[ -f $file ]]; then jq -n --rawfile content "$file" '{objectId: "abc", path: "/.lar-factory.json", content: $content}'; exit 0; fi
    echo "ERROR: TF401174: The item '/.lar-factory.json' could not be found in the repository '${BASH_REMATCH[3]}' at the version specified by '<Default branch>'." >&2
    exit 1
fi
echo "fake az: unexpected $*" >&2
exit 1
AZ
chmod +x "$bin/gh" "$bin/az"
export FAKE_AZ_LOG="$bin/az-log"
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

echo '{"repositories":[{"repo":"maddec01/lar-web","resetting":{"prUrl":"https://github.com/maddec01/lar-web/pull/14"}},{"repo":"maddec01/lar-factory"}]}' >"$list_file"
run --list
check "--list leaves out an entry resetting" '[{"repo":"maddec01/lar-factory"}]'

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

echo '{"repositories":[{"repo":"maddec01/lar-factory"},{"repo":"contoso/Fabrikam%20Fiber/lar-api"}]}' >"$list_file"
run --list
check "lists an Azure DevOps repository as organization/project/repository" '[{"repo":"maddec01/lar-factory"},{"repo":"contoso/Fabrikam%20Fiber/lar-api"}]'

for bad in contoso/Fabrikam/lar-api/x contoso/../lar-api contoso/Fabrikam/.. 'contoso/Fabrikam Fiber/lar-api'; do
    echo "{\"repositories\":[{\"repo\":\"$bad\"}]}" >"$list_file"
    run --list
    refuses "an Azure DevOps entry $bad names the file and the entry" "$list_file: repositories[0] needs a repo of the form owner/name"
done

# <owner/repo>

file maddec01/lar-factory '{"role":"factory"}'
run maddec01/lar-factory
check "fills in the defaults" '{"version":1,"role":"factory","itemSource":{"kind":"issues"},"show":"all","labels":[]}'

file maddec01/lar-server '{"version":1,"role":"server","itemSource":{"kind":"issues"},"show":"opted-in","labels":["area-api"]}'
run maddec01/lar-server
check "keeps the fields the file sets" '{"version":1,"role":"server","itemSource":{"kind":"issues"},"show":"opted-in","labels":["area-api"]}'

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
refuses "an unknown item source kind names itemSource.kind" "maddec01/broken: .lar-factory.json has an unsupported item source. Run onboarding again."

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

# An Azure repository

sprint='{"role":"web","itemSource":{"kind":"azure-board","team":"Web Team"},"show":"all"}'
file contoso/Fabrikam/web "$sprint"
want='{"version":1,"role":"web","itemSource":{"kind":"azure-board","team":"Web Team"},"show":"all","labels":[]}'
for origin in https://dev.azure.com/contoso/Fabrikam/_git/web https://contoso@dev.azure.com/contoso/Fabrikam/_git/web \
    git@ssh.dev.azure.com:v3/contoso/Fabrikam/web https://contoso.visualstudio.com/Fabrikam/_git/web contoso/Fabrikam/web; do
    : >"$FAKE_AZ_LOG"
    run "$origin"
    check "reads an Azure repository's file with az from $origin" "$want"
done
if [[ $(wc -l <"$FAKE_AZ_LOG") -eq 1 ]]; then pass "reads the file in one az call"; else fail "reads the file in one az call: $(cat "$FAKE_AZ_LOG")"; fi

file "contoso/Fabrikam Fiber/web" "$sprint"
run "https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/web"
check "passes a percent-encoded project name to az as its name" "$want"

file contoso/Fabrikam/api '{"role":"api","itemSource":{"kind":"azure-board","team":"API"},"show":"opted-in","labels":["area-api"]}'
run contoso/Fabrikam/api
check "keeps a combined Azure board source" '{"version":1,"role":"api","itemSource":{"kind":"azure-board","team":"API"},"show":"opted-in","labels":["area-api"]}'

file contoso/Fabrikam/board '{"role":"api","itemSource":{"kind":"azure-board","team":"API"}}'
run contoso/Fabrikam/board
check "reads the combined Azure board" '{"version":1,"role":"api","itemSource":{"kind":"azure-board","team":"API"},"show":"all","labels":[]}'

run contoso/Fabrikam/missing
refuses "Azure's missing item names the repository and the missing file" "contoso/Fabrikam/missing: no .lar-factory.json on its default branch"

file contoso/Fabrikam/broken '{"role": '
run contoso/Fabrikam/broken
refuses "an Azure file that doesn't parse names the repository" "contoso/Fabrikam/broken: .lar-factory.json isn't valid JSON"

file contoso/Fabrikam/broken '{"role":"web"}'
run contoso/Fabrikam/broken
refuses "an Azure repository has no default item source" ".lar-factory.json has an unsupported item source. Run onboarding again."

file contoso/Fabrikam/broken '{"role":"web","itemSource":{"kind":"issues"}}'
run contoso/Fabrikam/broken
refuses "an Azure repository can't read GitHub issues" ".lar-factory.json has an unsupported item source. Run onboarding again."

for kind in azure-board; do
    file contoso/Fabrikam/broken "{\"role\":\"web\",\"itemSource\":{\"kind\":\"$kind\"}}"
    run contoso/Fabrikam/broken
    refuses "an $kind without team names itemSource.team" "contoso/Fabrikam/broken: .lar-factory.json field itemSource.team must name the team for an $kind"
    file contoso/Fabrikam/broken "{\"role\":\"web\",\"itemSource\":{\"kind\":\"$kind\",\"team\":\"\"}}"
    run contoso/Fabrikam/broken
    refuses "an $kind with an empty team names itemSource.team" "field itemSource.team must name the team"
done

file maddec01/broken '{"role":"factory","itemSource":{"kind":"azure-board","team":"Web"}}'
run maddec01/broken
refuses "a GitHub repository can't read an Azure sprint" ".lar-factory.json has an unsupported item source. Run onboarding again."

FAKE_LOGGED_OUT=1 run contoso/Fabrikam/web
refuses "with az logged out, says to run az login" "az is logged out. Run az login"

FAKE_NO_EXTENSION=1 run contoso/Fabrikam/web
refuses "without the azure-devops extension, says to add it" "az extension add --name azure-devops"

for bad in https://dev.azure.com/contoso/Fabrikam/web https://dev.azure.com/contoso/../_git/web contoso/../web 'contoso/Fabrikam/we b' a/b/c/d \
    contoso/Fabrikam%2F..%2Fx/web contoso/%2E%2E/web contoso/Fabrikam/%5Cweb; do
    run "$bad"
    refuses "an Azure repository $bad shows the usage" "usage: repo-config.sh"
done

for kind in github-project azure-sprint azure-backlog unknown; do
    for repo in maddec01/broken contoso/Fabrikam/broken; do
        file "$repo" "{\"role\":\"web\",\"itemSource\":{\"kind\":\"$kind\",\"team\":\"Team\"}}"
        run "$repo"
        refuses "removed or unknown $kind asks for onboarding on $repo" "$repo: .lar-factory.json has an unsupported item source. Run onboarding again."
    done
done

((failures == 0))
