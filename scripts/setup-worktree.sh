#!/usr/bin/env bash
# Installs a worktree's dependencies with pnpm, whose global store hard-links
# packages, so each worktree costs almost no disk or time. Main's hooks run on
# worktrees of every branch, so it handles both layouts: the root workspace with
# apps/desktop, and, on a branch from before it, board/ and app/ with a lockfile each.
# Run: bash scripts/setup-worktree.sh [worktree]
# The target is the argument, T3's worktree or the current directory; never this
# script's own checkout, which is main when called through the hook or t3.json.
set -euo pipefail

worktree=$(git -C "${1:-${T3CODE_WORKTREE_PATH:-.}}" rev-parse --show-toplevel)

# Installs the package or workspace in $1, then fetches Electron's binary for the
# package in $2, which defaults to $1.
install() {
  local dir=$1 electron=${2:-$1}
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
  if [[ -f "$electron/node_modules/electron/install.js" ]]; then
    cd "$electron"
    node node_modules/electron/install.js
  fi
}

if [[ -f "$worktree/pnpm-workspace.yaml" ]]; then
  install "$worktree" "$worktree/apps/desktop"
  exit
fi

install "$worktree/board"
# app/ is the board app's Electron window; branches from before it have none.
if [[ -d "$worktree/app" ]]; then
  install "$worktree/app"
fi
