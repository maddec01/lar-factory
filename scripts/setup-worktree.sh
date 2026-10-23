#!/usr/bin/env bash
# Installs board/ and app/ dependencies in a worktree with pnpm, whose global store
# hard-links packages, so each worktree costs almost no disk or time.
# Run: bash scripts/setup-worktree.sh [worktree]
# The target is the argument, T3's worktree or the current directory; never this
# script's own checkout, which is main when called through the hook or t3.json.
set -euo pipefail

worktree=$(git -C "${1:-${T3CODE_WORKTREE_PATH:-.}}" rev-parse --show-toplevel)

install() {
  local dir=$1
  if [[ -d "$dir/node_modules" && ! -f "$dir/node_modules/.modules.yaml" ]]; then
    echo "setup-worktree: leaving $dir/node_modules alone: npm made it. Delete it to switch to pnpm."
    return
  fi

  command -v pnpm >/dev/null || {
    echo 'setup-worktree: pnpm not found on PATH. Install it with: brew install pnpm' >&2
    exit 1
  }

  # --ignore-scripts: creating a worktree must not run a branch's package.json scripts.
  cd "$dir"
  if [[ -f pnpm-lock.yaml ]]; then
    pnpm install --frozen-lockfile --prefer-offline --ignore-scripts
  else
    # A branch from before pnpm: install from package.json without writing a lockfile.
    echo 'setup-worktree: no pnpm-lock.yaml; installing without a lockfile.'
    pnpm install --prefer-offline --ignore-scripts --config.lockfile=false
  fi

  # pnpm never runs Electron's installer, so fetch its binary with the locked
  # package's own install.js, which reuses @electron/get's download cache.
  if [[ -f node_modules/electron/install.js ]]; then
    node node_modules/electron/install.js
  fi
}

install "$worktree/board"
# app/ is the board app's Electron window; branches from before it have none.
if [[ -d "$worktree/app" ]]; then
  install "$worktree/app"
fi
