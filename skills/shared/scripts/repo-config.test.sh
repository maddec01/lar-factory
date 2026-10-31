#!/usr/bin/env bash
# Local settings tests. Provider commands are traps; no network is allowed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/home"
export HOME="$fixture/home" PATH="$fixture/bin:$PATH" PROVIDER_CALLS="$fixture/provider-calls"
for tool in gh az git curl; do
    cat >"$fixture/bin/$tool" <<'FAKE'
#!/bin/bash
printf '%s\n' "$0 $*" >>"$PROVIDER_CALLS"
exit 99
FAKE
    chmod +x "$fixture/bin/$tool"
done
data="$HOME/Library/Application Support/Lar Factory"
mkdir -p "$data"
list_file="$data/repository-settings.json"
failures=0
run() {
    status=0
    output=$(bash "$here/repo-config.sh" "$@" 2>"$fixture/errors") || status=$?
    errors=$(cat "$fixture/errors")
}
check() {
    if (( status == 0 )) && [[ -z $errors ]] && jq -e --argjson want "$2" '. == $want' <<<"$output" >/dev/null; then
        printf 'ok   %s\n' "$1"
    else
        printf 'FAIL %s: %s %s / %s\n' "$1" "$status" "$output" "$errors"
        failures=$((failures + 1))
    fi
}
refuses() {
    if (( status != 0 )) && [[ -z $output && $errors == *"$2"* ]]; then
        printf 'ok   %s\n' "$1"
    else
        printf 'FAIL %s: %s %s / %s\n' "$1" "$status" "$output" "$errors"
        failures=$((failures + 1))
    fi
}
defaults='{"version":1,"role":"","itemSource":{"kind":"issues"},"labels":[],"domainDocs":{"kind":"private"},"skills":[],"structureSync":true}'
run --list
check 'missing local file has an empty list' '[]'
run team/app
refuses 'missing repository needs onboarding, without remote fallback' "isn't onboarded"
printf '%s' '{"repositories":[{"repo":"team/App"},{"repo":"team/api"},{"repo":"org/project/repo"}],"connections":[["team/app","team/api"],["team/api","team/APP"],["team/App","gone/repo"],["team/app","team/App"],"invalid"]}' >"$list_file"
run --list
check 'list preserves local entries' '[{"repo":"team/App"},{"repo":"team/api"},{"repo":"org/project/repo"}]'
run team/app
check 'an empty local entry uses built-in defaults and needs no role' "$defaults"
run --connections TEAM/APP
check 'connections deduplicate and omit unlisted/self pairs' '["team/api"]'
run --connections team/api
check 'connections work from either end' '["team/App"]'
run --connections missing/repo
refuses 'connections require a listed repository' "isn't onboarded"
run --connections
refuses 'connections require an argument' 'usage:'
run 'https://dev.azure.com/org/project/_git/repo'
check 'Azure URL resolves locally without az or a configured team' "$(jq '.itemSource=null' <<<"$defaults")"
run 'git@ssh.dev.azure.com:v3/org/project/repo'
check 'Azure SSH origin resolves locally' "$(jq '.itemSource=null' <<<"$defaults")"
run 'https://org.visualstudio.com/project/_git/repo'
check 'legacy Azure origin resolves locally' "$(jq '.itemSource=null' <<<"$defaults")"
printf '%s' '{"repositories":[{"repo":"team/app","settings":{"shared":{"role":"Ignored","domainDocs":{"kind":"repository","glossary":"OLD.md","adrs":"old"}},"overrides":{"role":"App","domainDocs":{"kind":"repository","glossary":"GLOSSARY.md","adrs":"docs/adr"},"labels":["feature"],"skills":["style"],"vocabulary":{"build":{"type":null,"labels":[]}}},"structureSync":false}}]}' >"$list_file"
run team/app
check 'only local overrides apply; explicit sync false survives' "$(jq '.role="App" | .domainDocs={kind:"repository",glossary:"GLOSSARY.md",adrs:"docs/adr"} | .labels=["feature"] | .skills=["style"] | .vocabulary={build:{type:null,labels:[]}} | .structureSync=false' <<<"$defaults")"
printf '%s' '{"repositories":[{"repo":"team/app","settings":{"shared":{"role":"Ignored","structureSync":false}}}]}' >"$list_file"
run team/app
check 'cached shared defaults cannot change local settings or sync' "$defaults"
printf '%s' '{"repositories":[{"repo":"team/app","settings":{"structureSync":true}}]}' >"$list_file"
run team/app
check 'explicit structure sync ON survives' "$defaults"
printf '%s' '{"repositories":[{"repo":"team/app","settings":{"structureSync":false}}]}' >"$list_file"
LAR_FACTORY_DATA_DIR="$fixture/elsewhere" run --list
check 'absolute data directory override is honored' '[]'
LAR_FACTORY_DATA_DIR=relative run team/app
check 'relative data directory override is ignored' "$(jq '.structureSync=false' <<<"$defaults")"
for entry in '"bad"' '{"repo":"team/.."}' '{"repo":"team/app\n"}' '{"repo":"../project/repo"}'; do
    printf '{"repositories":[%s]}' "$entry" >"$list_file"
    run --list
    refuses 'invalid repository entry fails locally' 'repositories[0] needs a repo'
done
printf '%s' '{bad' >"$list_file"
run --list
refuses 'invalid JSON names local file' "$list_file isn't valid JSON"
printf '%s' '[]' >"$list_file"
run --list
refuses 'invalid root shape fails' 'expected an object'
for settings in '[]' '{"overrides":[]}' '{"structureSync":"yes"}' '{"structureSync":null}' '{"overrides":{"role":1}}' '{"overrides":{"skills":[1]}}' '{"overrides":{"labels":"x"}}' '{"overrides":{"itemSource":{"kind":"azure-board"}}}' '{"overrides":{"domainDocs":{"kind":"repository"}}}'; do
    printf '{"repositories":[{"repo":"team/app","settings":%s}]}' "$settings" >"$list_file"
    run team/app
    refuses 'invalid local settings fail before output' "$list_file: team/app:"
done
run 'team/..'
refuses 'invalid argument fails without a provider call' 'usage:'
if [[ -e $PROVIDER_CALLS ]]; then
    printf 'FAIL provider command was called\n'
    failures=$((failures + 1))
else
    printf 'ok   no provider command was called\n'
fi
exit "$failures"
