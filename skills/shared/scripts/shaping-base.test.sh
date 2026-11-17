#!/bin/bash
# Real local remotes: a stale, dirty checkout and a renamed remote default.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
git init -q -b main "$tmp/producer"
git -C "$tmp/producer" config user.name Test
git -C "$tmp/producer" config user.email test@example.com
echo old >"$tmp/producer/code"
git -C "$tmp/producer" add code
git -C "$tmp/producer" commit -qm initial
git clone -q --bare "$tmp/producer" "$tmp/origin.git"
git clone -q "$tmp/origin.git" "$tmp/checkout"
initial=$(git -C "$tmp/checkout" rev-parse HEAD)
echo 'local edit' >"$tmp/checkout/code"

echo current >"$tmp/producer/code"
git -C "$tmp/producer" commit -qam current
git -C "$tmp/producer" push -q "$tmp/origin.git" main
current=$(git -C "$tmp/producer" rev-parse HEAD)
evidence=$(bash "$here/shaping-base.sh" "$tmp/checkout")
[[ $(jq -r .ref <<<"$evidence") == origin/main ]]
[[ $(jq -r .revision <<<"$evidence") == "$current" ]]
[[ $(git -C "$tmp/checkout" show "$current:code") == current ]]
[[ $(git -C "$tmp/checkout" rev-parse HEAD) == "$initial" ]]
[[ $(cat "$tmp/checkout/code") == 'local edit' ]]
printf 'ok   fresh code and exact evidence without touching local HEAD or edits\n'

git -C "$tmp/producer" switch -qc trunk
echo renamed >"$tmp/producer/code"
git -C "$tmp/producer" commit -qam renamed
git -C "$tmp/producer" push -q "$tmp/origin.git" trunk
git --git-dir="$tmp/origin.git" symbolic-ref HEAD refs/heads/trunk
current=$(git -C "$tmp/producer" rev-parse HEAD)
evidence=$(bash "$here/shaping-base.sh" "$tmp/checkout")
[[ $(jq -r .ref <<<"$evidence") == origin/trunk ]]
[[ $(jq -r .revision <<<"$evidence") == "$current" ]]
[[ $(git -C "$tmp/checkout" show "$current:code") == renamed ]]
printf 'ok   remote default wins over stale origin/HEAD and local main\n'

mv "$tmp/origin.git" "$tmp/unavailable.git"
if bash "$here/shaping-base.sh" "$tmp/checkout" >"$tmp/evidence" 2>"$tmp/error"; then
    echo 'FAIL unavailable origin accepted stale evidence' >&2
    exit 1
fi
[[ ! -s $tmp/evidence ]]
printf 'ok   unavailable origin fails without stale evidence\n'
