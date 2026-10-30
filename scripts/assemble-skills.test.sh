#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/assemble-skills.mjs
for skill in lar-shape lar-build; do
  diff -r skills/shared ".assembled-skills/$skill/shared"
done
test -f .assembled-skills/lar-build/references/security-checklist.md
test -f .assembled-skills/lar-build/skills/security-and-hardening/SKILL.md
printf stale > .assembled-skills/lar-shape/stale
node scripts/assemble-skills.mjs
test ! -e .assembled-skills/lar-shape/stale
