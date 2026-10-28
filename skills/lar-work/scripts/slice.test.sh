#!/usr/bin/env bash
# Tests slice.sh against a fake gh, a fake az and a fake sleep. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
slice="$here/slice.sh"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# A fake gh. A read of a repository's .lar-factory.json logs "config <owner/repo>"
# repository's issues when it is "issues", and GitHub's 404 when it is "none".
# `issue create` logs its args and prints the new issue's URL. Each
bin=$(mktemp -d)
log="$bin/log"
cat >"$bin/gh" <<'EOF'
#!/bin/bash
if [[ $1 == api && $* =~ \ repos/([^/]+/[^/]+)/contents/\.lar-factory\.json$ ]]; then
    echo "config ${BASH_REMATCH[1]}" >>"$FAKE_GH_LOG"
    case ${FAKE_ITEMS:-issues} in
    issues) echo '{"role": "factory", "itemSource": {"kind": "issues"}}' ;;
    *) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
    esac
    exit 0
fi
case "$1 $2" in
"issue create")
    echo "create ${*:3}" >>"$FAKE_GH_LOG"
    echo "https://github.com/maddec01/lar-factory/issues/999"
    ;;
*)
    echo "fake gh: unexpected $*" >&2
    exit 1
    ;;
esac
EOF
cat >"$bin/sleep" <<'EOF'
#!/bin/bash
echo "sleep $*" >>"$FAKE_GH_LOG"
EOF
# A fake az that answers the Task create: it logs "az <args>", then the JSON patch
# on one line, and prints the new work item 77. With FAKE_AZ_ERROR set it fails with it.
cat >"$bin/az" <<'EOF'
#!/bin/bash
echo "az $*" >>"$FAKE_GH_LOG"
if [[ -n ${FAKE_AZ_ERROR:-} ]]; then echo "$FAKE_AZ_ERROR" >&2; exit 1; fi
args="$*" file=${args#*--in-file }
jq -c . "${file%% *}" >>"$FAKE_GH_LOG"
echo "WARNING: an az warning on stderr" >&2
echo '{"id": 77, "rev": 1, "fields": {"System.WorkItemType": "Task"}}'
EOF
# A fake curl that logs "curl <args>", for the read request to the board.
cat >"$bin/curl" <<'EOF'
#!/bin/bash
echo "curl $*" >>"$FAKE_GH_LOG"
EOF
chmod +x "$bin/gh" "$bin/sleep" "$bin/az" "$bin/curl"
items="$bin/items"
# slice.sh reads board records from this home, never the real one.
export FAKE_GH_LOG="$log" FAKE_GH_ITEMS="$items" PATH="$bin:$PATH" HOME="$bin/home"

body="$bin/body.md"
echo "What to build" >"$body"

# run <items, one line per poll>: runs slice.sh with fresh logs, sets $output
# (stdout), $errors (stderr) and $status. The parent is PARENT, else 133.
run() {
    printf '%s\n' "$@" >"$items"
    : >"$log"
    status=0
    output=$(bash "$slice" maddec01/lar-factory "${PARENT:-133}" "A slice" "$body" 2>"$bin/err") || status=$?
    errors=$(cat "$bin/err")
}
count() { grep -c "^$1" "$log" || true; }

url=https://github.com/maddec01/lar-factory/issues/999

FAKE_ITEMS=issues run "PVTI_a"
if ((status == 0)) && [[ $output == "$url" && -z $errors ]] &&
    (($(count query) == 0 && $(count sleep) == 0 && $(count delete) == 0 && $(count create) == 1)); then
    pass "on a repository that reads its issues, creates the slice and prints its URL with no polling"
else
    fail "on a repository that reads its issues, creates the slice and prints its URL with no polling: $status $output / $errors / $(cat "$log")"
fi

FAKE_ITEMS=none run ""
if ((status != 0)) && [[ -z $output && $errors == *"maddec01/lar-factory: no .lar-factory.json on its default branch."* ]] &&
    (($(count create) == 0)) && [[ $errors != *"created"* ]]; then
    pass "a failing lookup stops before creating the slice and passes its message through"
else
    fail "a failing lookup stops before creating the slice and passes its message through: $status $output / $errors / $(cat "$log")"
fi

PARENT=https://github.com/maddec01/lar-server/issues/5 run ""
if ((status == 0)) && [[ $(sed -n 1p "$log") == "config maddec01/lar-server" ]]; then
    pass "a parent URL in another repository looks up the build's repository"
else
    fail "a parent URL in another repository looks up the build's repository: $status $output / $errors / $(cat "$log")"
fi

if output=$(bash "$slice" maddec01/lar-factory 133 2>&1); then
    fail "missing arguments print usage: $output"
else
    if [[ $output == *usage* ]]; then pass "missing arguments print usage"; else fail "missing arguments print usage: $output"; fi
fi

# On Azure DevOps

azure_build=https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/42
printf '## What to build\n\nA "quoted" line.\n' >"$body"
: >"$log"
status=0
output=$(bash "$slice" contoso/Fabrikam%20Fiber/web "$azure_build" "A slice" "$body" 2>"$bin/err") || status=$?
errors=$(cat "$bin/err")
want_patch=$(jq -nc --rawfile body "$body" '[{op: "add", path: "/fields/System.Title", value: "A slice"},
    {op: "add", path: "/fields/System.Description", value: $body},
    {op: "add", path: "/multilineFieldsFormat/System.Description", value: "Markdown"},
    {op: "add", path: "/relations/-", value: {rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/contoso/_apis/wit/workItems/42"}}]')
if ((status == 0)) && [[ $output == https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/77 && -z $errors ]] &&
    [[ $(sed -n 1p "$log") == "az devops invoke --area wit --resource workitems --organization https://dev.azure.com/contoso --route-parameters project=Fabrikam Fiber type=Task --http-method POST --media-type application/json-patch+json --in-file "*" --api-version 7.2-preview --output json" ]] &&
    [[ $(sed -n 2p "$log") == "$want_patch" ]] && (($(wc -l <"$log") == 2)); then
    pass "on Azure DevOps, creates a Task under the build's work item in one call and prints its URL"
else
    fail "on Azure DevOps, creates a Task under the build's work item in one call and prints its URL: $status $output / $errors / $(cat "$log")"
fi

: >"$log"
status=0
output=$(FAKE_AZ_ERROR="ERROR: Before you can run Azure DevOps commands, you need to run the login command (az login if using AAD/MSA identity else az devops login if using PAT token) to setup credentials." \
    bash "$slice" contoso/Fabrikam/web "$azure_build" "A slice" "$body" 2>"$bin/err") || status=$?
errors=$(cat "$bin/err")
if ((status != 0)) && [[ -z $output && $errors == "slice.sh: az is logged out. Run az login, then rerun." ]]; then
    pass "on Azure DevOps with az logged out, says to run az login"
else
    fail "on Azure DevOps with az logged out, says to run az login: $status $output / $errors"
fi

: >"$log"
status=0
output=$(bash "$slice" contoso/Fabrikam/web 42 "A slice" "$body" 2>"$bin/err") || status=$?
errors=$(cat "$bin/err")
if ((status != 0)) && [[ -z $output && $errors == *"the parent is the build's work item URL"* ]] && [[ ! -s $log ]]; then
    pass "on an Azure repository, a parent that isn't a work item URL stops before any call"
else
    fail "on an Azure repository, a parent that isn't a work item URL stops before any call: $status $output / $errors / $(cat "$log")"
fi

# A made slice asks the board on LAR_BOARD_PORT to read its build's source.
export LAR_BOARD_PORT=4999
FAKE_ITEMS=issues run ""
if ((status == 0)) && grep -qF '"url":"https://github.com/maddec01/lar-factory/issues/133"' "$log" && grep -q '127.0.0.1:4999/api/read' "$log"; then
    pass "a made slice asks the board to read its build's source"
else
    fail "a made slice asks the board to read its build's source: $status $output / $errors / $(cat "$log")"
fi
unset LAR_BOARD_PORT

rm -rf "$bin"
((failures == 0)) || { echo "$failures failed"; exit 1; }
echo "all passed"
