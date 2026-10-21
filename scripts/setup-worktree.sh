#!/usr/bin/env bash
# Installs board/ dependencies in a worktree with pnpm, whose global store
# hard-links packages, so each worktree costs almost no disk or time.
# Run: bash scripts/setup-worktree.sh [worktree]
# The target is the argument, T3's worktree or the current directory; never this
# script's own checkout, which is main when called through the hook or t3.json.
set -euo pipefail

worktree=$(git -C "${1:-${T3CODE_WORKTREE_PATH:-.}}" rev-parse --show-toplevel)
board="$worktree/board"

if [[ -d "$board/node_modules" && ! -f "$board/node_modules/.modules.yaml" ]]; then
  echo "setup-worktree: leaving $board/node_modules alone: npm made it. Delete it to switch to pnpm."
  exit 0
fi

command -v pnpm >/dev/null || {
  echo 'setup-worktree: pnpm not found on PATH. Install it with: brew install pnpm' >&2
  exit 1
}

# --ignore-scripts: creating a worktree must not run a branch's package.json scripts.
cd "$board"
if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile --prefer-offline --ignore-scripts
else
  # A branch from before pnpm: install from package.json without writing a lockfile.
  echo 'setup-worktree: no pnpm-lock.yaml; installing without a lockfile.'
  pnpm install --prefer-offline --ignore-scripts --config.lockfile=false
fi
