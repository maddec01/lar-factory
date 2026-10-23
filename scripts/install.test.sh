#!/usr/bin/env bash
# Tests install.sh against fake homes and checkouts with stubbed npx and gh. No network.
set -euo pipefail

source "$(dirname "$0")/install.sh"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# A home laid out like `npx skills add`: copies in ~/.agents/skills, symlinks in
# ~/.claude/skills, checklists in both references folders.
make_home() {
  local home
  home=$(mktemp -d)
  local name
  for name in "${CHECKED_SKILLS[@]}"; do
    mkdir -p "$home/.agents/skills/$name/references" "$home/.claude/skills"
    printf 'See `../../references/a.md` and [b](../../references/b.md#part).\n' \
      >"$home/.agents/skills/$name/SKILL.md"
    printf 'Nested: `../../../references/a.md#top`.\n' \
      >"$home/.agents/skills/$name/references/extra.md"
    ln -s "../../.agents/skills/$name" "$home/.claude/skills/$name"
  done
  mkdir -p "$home/.agents/references" "$home/.claude/references"
  touch "$home/.agents/references/a.md" "$home/.agents/references/b.md" \
    "$home/.claude/references/a.md" "$home/.claude/references/b.md"
  printf '%s' "$home"
}

home=$(make_home)
if output=$(check_references "$home" 2>&1); then
  pass "passes when every path resolves, anchors dropped"
else
  fail "passes when every path resolves: $output"
fi

home=$(make_home)
rm "$home/.claude/references/b.md"
if output=$(check_references "$home" 2>&1); then
  fail "fails when a path is missing under ~/.claude"
elif [[ $output == *"$home/.claude/skills/${CHECKED_SKILLS[0]}/SKILL.md"*"../../references/b.md"* ]]; then
  pass "fails and names the file and path when a path is missing under ~/.claude"
else
  fail "names the missing path: $output"
fi

home=$(make_home)
rm -r "$home/.claude/references"
if output=$(check_references "$home" 2>&1); then
  fail "takes ~/.claude paths literally, not through the symlink"
else
  pass "takes ~/.claude paths literally, not through the symlink"
fi

home=$(make_home)
for name in "${CHECKED_SKILLS[@]}"; do
  printf 'No links here.\n' >"$home/.agents/skills/$name/SKILL.md"
  rm "$home/.agents/skills/$name/references/extra.md"
done
if output=$(check_references "$home" 2>&1); then
  fail "fails when it finds no paths"
elif [[ $output == *"no ../ paths"* ]]; then
  pass "fails when it finds no paths"
else
  fail "says it found no paths: $output"
fi

home=$(make_home)
rm "$home/.claude/skills/${CHECKED_SKILLS[0]}"
if output=$(check_references "$home" 2>&1); then
  fail "fails when a skill is not installed"
else
  pass "fails when a skill is not installed"
fi

root="$(cd "$(dirname "$0")/.." && pwd)"

# Runs install.sh from a checkout at $1 with stubbed npx and gh and an empty home,
# and prints the skills it passes to `npx skills add`, sorted. The stubbed gh
# fails once install.sh fetches references/, so main stops after npx.
installed_skills() {
  local stubs args
  stubs=$(mktemp -d)
  args="$stubs/npx-args"
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" >%q\n' "$args" >"$stubs/npx"
  printf '#!/usr/bin/env bash\n[[ $1 == auth ]]\n' >"$stubs/gh"
  chmod +x "$stubs/npx" "$stubs/gh"
  PATH="$stubs:$PATH" HOME=$(mktemp -d) bash "$1/scripts/install.sh" >/dev/null 2>&1 || true
  [[ -f $args ]] && awk '/^-y$/ { f = 0 } f; /^-s$/ { f = 1 }' "$args" | sort
}

folders() {
  for dir in "$1"/skills/*/; do basename "$dir"; done | sort
}

# A checkout with install.sh, UPSTREAM.md and an empty folder per skill.
make_checkout() {
  local checkout dir
  checkout=$(mktemp -d)
  mkdir -p "$checkout/scripts"
  cp "$root/scripts/install.sh" "$checkout/scripts/"
  cp "$root/UPSTREAM.md" "$checkout/"
  for dir in "$root"/skills/*/; do mkdir -p "$checkout/skills/$(basename "$dir")"; done
  printf '%s' "$checkout"
}

if [[ $(installed_skills "$root") == "$(folders "$root")" ]]; then
  pass "installs exactly the folders under skills/"
else
  fail "installs exactly the folders under skills/: $(diff <(installed_skills "$root") <(folders "$root") | tr '\n' ' ')"
fi

checkout=$(make_checkout)
mkdir "$checkout/skills/new-copy"
if [[ $(installed_skills "$checkout") == "$(folders "$checkout")" ]]; then
  fail "fails when a folder has no UPSTREAM.md row"
else
  pass "fails when a folder has no UPSTREAM.md row"
fi

checkout=$(make_checkout)
grep -v '^| `tdd`' "$root/UPSTREAM.md" >"$checkout/UPSTREAM.md"
if [[ $(installed_skills "$checkout") == "$(folders "$checkout")" ]]; then
  fail "fails when a row is missing from UPSTREAM.md"
else
  pass "fails when a row is missing from UPSTREAM.md"
fi

missing=()
while read -r source commit; do
  grep -qE "^Full commits:.*$source \`$commit[0-9a-f]{28}\`" "$root/UPSTREAM.md" || missing+=("$source $commit")
done < <(awk -F'|' '/^\| `/ { gsub(/[ `]/, "", $3); gsub(/[ `]/, "", $5); print $3, $5 }' "$root/UPSTREAM.md" | sort -u)
if ((${#missing[@]} == 0)); then
  pass "every source and commit in UPSTREAM.md has a full commit"
else
  fail "every source and commit in UPSTREAM.md has a full commit; missing: ${missing[*]}"
fi

((failures == 0)) || { printf '%d failed\n' "$failures"; exit 1; }
printf 'all passed\n'
