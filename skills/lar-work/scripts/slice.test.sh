#!/usr/bin/env bash
# Tests slice.sh against a fake gh and a fake sleep. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
slice="$here/slice.sh"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# A fake gh. A read of a repository's .lar-factory.json logs "config <owner/repo>"
# and reads Project 3 of lar-org when FAKE_ITEMS is "project" (the default), the
# repository's issues when it is "issues", and GitHub's 404 when it is "none".
# `issue create` logs its args and prints the new issue's URL. Each
# Project item query answers with the items of line N of $FAKE_GH_ITEMS (item ids,
# comma-separated) on poll N, then of the last line forever, plus one on another
# Project; it fails on a line "!fail" or if FAKE_GH_QUERY_FAILS is set;
# `project item-delete` logs the id.
bin=$(mktemp -d)
log="$bin/log"
cat >"$bin/gh" <<'EOF'
#!/bin/bash
if [[ $1 == api && $* =~ \ repos/([^/]+/[^/]+)/contents/\.lar-factory\.json$ ]]; then
    echo "config ${BASH_REMATCH[1]}" >>"$FAKE_GH_LOG"
    case ${FAKE_ITEMS:-project} in
    issues) echo '{"role": "factory", "itemSource": {"kind": "issues"}}' ;;
    project) echo '{"role": "factory", "itemSource": {"kind": "github-project", "owner": "lar-org", "number": 3}}' ;;
    *) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
    esac
    exit 0
fi
case "$1 $2" in
"issue create")
    echo "create ${*:3}" >>"$FAKE_GH_LOG"
    echo "https://github.com/maddec01/lar-factory/issues/999"
    ;;
"api graphql")
    poll=$(( $(grep -c '^query' "$FAKE_GH_LOG") + 1 ))
    echo "query" >>"$FAKE_GH_LOG"
    [[ -z "${FAKE_GH_QUERY_FAILS:-}" ]] || { echo "fake gh: query failed" >&2; exit 1; }
    line=$(sed -n "${poll}p" "$FAKE_GH_ITEMS")
    [[ -n "$line" ]] || line=$(tail -n1 "$FAKE_GH_ITEMS")
    [[ $line != "!fail" ]] || { echo "fake gh: query failed" >&2; exit 1; }
    # The issue's Project items as GitHub answers: these ids on Project 3 of lar-org, and one on another Project.
    jq -c --arg ids "$line" '{data: {resource: {projectItems: {nodes: ([$ids | split(",")[] | select(. != "")
        | {id: ., project: {number: 3, owner: {login: "lar-org"}}}] + [{id: "PVTI_other", project: {number: 3, owner: {login: "maddec01"}}}])}}}}' <<<null
    ;;
"project item-delete")
    echo "delete ${*:3}" >>"$FAKE_GH_LOG"
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
chmod +x "$bin/gh" "$bin/sleep"
items="$bin/items"
export FAKE_GH_LOG="$log" FAKE_GH_ITEMS="$items" PATH="$bin:$PATH"

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

run "PVTI_a" ""
if ((status == 0)) && [[ $output == "$url" ]] &&
    [[ $(sed -n 1p "$log") == "config maddec01/lar-factory" ]] &&
    [[ $(sed -n 2p "$log") == "create --repo maddec01/lar-factory --parent 133 --title A slice --body-file $body" ]] &&
    [[ $(grep '^delete' "$log") == "delete 3 --owner lar-org --id PVTI_a" ]] &&
    (($(count query) == 2)) && (($(count 'sleep 2') == 1)) && [[ $errors == *"watching"* ]]; then
    pass "an item on the Project is removed, polling stops at the next empty poll, the URL is printed"
else
    fail "an item on the Project is removed, polling stops at the next empty poll, the URL is printed: $status $output / $errors / $(cat "$log")"
fi

run ""
if ((status == 0)) && [[ $output == "$url" ]] && (($(count delete) == 0)) &&
    (($(count query) == 11)) && (($(count 'sleep 2') == 10)); then
    pass "an issue that never lands on the Project polls the whole window and succeeds"
else
    fail "an issue that never lands on the Project polls the whole window and succeeds: $status $output / $(cat "$log")"
fi

run "" "" "" "PVTI_late" ""
if ((status == 0)) && [[ $output == "$url" ]] &&
    [[ $(grep '^delete' "$log") == "delete 3 --owner lar-org --id PVTI_late" ]] &&
    (($(count query) == 5)); then
    pass "a late auto-add is removed on a later poll"
else
    fail "a late auto-add is removed on a later poll: $status $output / $(cat "$log")"
fi

run "PVTI_stuck"
if ((status != 0)) && [[ $errors == *"$url"*"still on Project 3 of lar-org"* ]] &&
    [[ $errors == *"gh project item-delete 3 --owner lar-org --id PVTI_stuck"* ]]; then
    pass "an item that persists after the poll fails with the command that removes it"
else
    fail "an item that persists after the poll fails with the command that removes it: $status $errors"
fi

FAKE_GH_QUERY_FAILS=1 run ""
if ((status != 0)) && [[ -z $output ]] && [[ $errors == *"created $url"*"don't rerun"*"gh project item-list 3 --owner lar-org"* ]]; then
    pass "a failure after creation names the created slice"
else
    fail "a failure after creation names the created slice: $status $output / $errors"
fi

run "PVTI_a" "!fail"
if ((status != 0)) && [[ $(grep '^delete' "$log") == "delete 3 --owner lar-org --id PVTI_a" ]] &&
    [[ $errors == *"created $url"*"may be on Project 3 of lar-org"*"gh project item-list"* ]] &&
    [[ $errors != *"--id PVTI_a"* ]]; then
    pass "a failure after a removal doesn't ask to remove the already-removed item"
else
    fail "a failure after a removal doesn't ask to remove the already-removed item: $status $errors / $(cat "$log")"
fi

: >"$log"
if SLICE_POLL_INTERVAL=1 SLICE_POLL_TIMEOUT=3 run "" && (($(count query) == 4)) && (($(count 'sleep 1') == 3)); then
    pass "the poll interval and timeout are overridable"
else
    fail "the poll interval and timeout are overridable: $(cat "$log")"
fi

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

rm -rf "$bin"
((failures == 0)) || { echo "$failures failed"; exit 1; }
echo "all passed"
