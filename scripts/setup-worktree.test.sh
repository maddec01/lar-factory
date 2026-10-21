#!/usr/bin/env bash
# Tests setup-worktree.sh and the post-checkout hook against throwaway repos and
# a fake pnpm. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
setup="$here/setup-worktree.sh"
hooks="$here/../.githooks"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# A fake pnpm that logs "<dir> <args>" and lays out node_modules like pnpm does.
bin=$(mktemp -d)
calls="$bin/calls"
cat >"$bin/pnpm" <<'EOF'
#!/bin/bash
printf '%s %s\n' "$PWD" "$*" >>"$FAKE_PNPM_CALLS"
[[ -z "${FAKE_PNPM_FAIL:-}" ]] || exit 1
[[ -f node_modules/.modules.yaml ]] || { mkdir -p node_modules; echo 'layoutVersion: 5' >node_modules/.modules.yaml; }
EOF
chmod +x "$bin/pnpm"
export FAKE_PNPM_CALLS="$calls" PATH="$bin:$PATH"

# A repo with a pnpm board/ and no setup script, so the hook must run main's.
make_repo() {
  local repo
  repo=$(cd "$(mktemp -d)" && pwd -P)/repo
  git init -q -b main "$repo"
  git -C "$repo" config user.name Test
  git -C "$repo" config user.email test@example.invalid
  mkdir "$repo/board"
  printf '{}\n' >"$repo/board/package.json"
  printf "lockfileVersion: '9.0'\n" >"$repo/board/pnpm-lock.yaml"
  printf 'node_modules/\n' >"$repo/board/.gitignore"
  git -C "$repo" add .
  git -C "$repo" commit -qm 'feat(board): initial fixture'
  printf '%s' "$repo"
}

state() { find "$1/board" -exec stat -f '%N %m %z' {} + | sort; }

repo=$(make_repo)
: >"$calls"
if output=$(bash "$setup" "$repo" 2>&1) &&
  [[ $(cat "$calls") == "$repo/board install --frozen-lockfile --prefer-offline --ignore-scripts" ]]; then
  pass "a fresh worktree gets installed"
else
  fail "a fresh worktree gets installed: $output / $(cat "$calls")"
fi

before=$(state "$repo")
: >"$calls"
if output=$(bash "$setup" "$repo" 2>&1) && [[ $(state "$repo") == "$before" ]]; then
  pass "a second run changes nothing"
else
  fail "a second run changes nothing: $output"
fi

repo=$(make_repo)
mkdir "$repo/board/node_modules"
: >"$calls"
if output=$(bash "$setup" "$repo" 2>&1) && [[ ! -s $calls ]] &&
  [[ $output == *npm* ]] && [[ ! -e $repo/board/node_modules/.modules.yaml ]]; then
  pass "an npm-made node_modules is left alone"
else
  fail "an npm-made node_modules is left alone: $output / $(cat "$calls")"
fi

repo=$(make_repo)
git -C "$repo" mv board/pnpm-lock.yaml board/package-lock.json
git -C "$repo" commit -qm 'build(board): a branch from before pnpm'
: >"$calls"
if output=$(bash "$setup" "$repo" 2>&1) &&
  [[ $(cat "$calls") == "$repo/board install --prefer-offline --ignore-scripts --config.lockfile=false" ]] &&
  [[ -z $(git -C "$repo" status --porcelain) ]]; then
  pass "a branch from before pnpm installs without writing a lockfile"
else
  fail "a branch from before pnpm installs without writing a lockfile: $output / $(cat "$calls")"
fi

repo=$(make_repo)
mkdir "$repo/sub"
: >"$calls"
if output=$(cd "$repo/sub" && T3CODE_WORKTREE_PATH="$repo/sub" bash "$setup" 2>&1) &&
  [[ $(cat "$calls") == "$repo/board install"* ]]; then
  pass "finds the worktree from T3CODE_WORKTREE_PATH"
else
  fail "finds the worktree from T3CODE_WORKTREE_PATH: $output / $(cat "$calls")"
fi

repo=$(make_repo)
nopnpm=$(mktemp -d)
ln -s "$(command -v git)" "$nopnpm/git"
if output=$(PATH="$nopnpm:/usr/bin:/bin" bash "$setup" "$repo" 2>&1); then
  fail "fails without pnpm"
elif [[ $output == *"brew install pnpm"* ]]; then
  pass "fails without pnpm and names brew install pnpm"
else
  fail "names brew install pnpm: $output"
fi

repo=$(make_repo)
git -C "$repo" config core.hooksPath "$hooks"
: >"$calls"
if output=$(git -C "$repo" worktree add -q ../x -b test 2>&1) &&
  [[ $(cat "$calls") == "$(dirname "$repo")/x/board install --frozen-lockfile --prefer-offline --ignore-scripts" ]]; then
  pass "the hook installs a new worktree"
else
  fail "the hook installs a new worktree: $output / $(cat "$calls")"
fi

: >"$calls"
if output=$(git -C "$repo" switch -qc other 2>&1 && git -C "$repo" switch -q main 2>&1) && [[ ! -s $calls ]]; then
  pass "the hook skips an ordinary branch switch"
else
  fail "the hook skips an ordinary branch switch: $output / $(cat "$calls")"
fi

other=$(make_repo)
: >"$calls"
if output=$(T3CODE_WORKTREE_PATH="$other" git -C "$repo" worktree add -q ../z -b test3 2>&1) &&
  [[ $(cat "$calls") == "$(dirname "$repo")/z/board install"* ]]; then
  pass "the hook installs the new worktree, not T3CODE_WORKTREE_PATH"
else
  fail "the hook installs the new worktree, not T3CODE_WORKTREE_PATH: $output / $(cat "$calls")"
fi

if output=$(FAKE_PNPM_FAIL=1 git -C "$repo" worktree add -q ../y -b test2 2>&1) &&
  [[ -d $(dirname "$repo")/y ]] && [[ $output == *warning* ]] &&
  [[ $output == *"$setup\" \"$(dirname "$repo")/y\""* ]]; then
  pass "a failed setup warns and still creates the worktree"
else
  fail "a failed setup warns and still creates the worktree: $output"
fi

((failures == 0)) || { printf '%d failed\n' "$failures"; exit 1; }
printf 'all passed\n'
