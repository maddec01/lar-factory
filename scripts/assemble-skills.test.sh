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

test -f .assembled-skills/lar-build/SKILL.md
test -f .assembled-skills/lar-build/agents/builder.md
test ! -d skills/lar-work
python3 - <<'PY'
from pathlib import Path
import re
for skill in ('lar-shape', 'lar-build'):
 root=Path('.assembled-skills')/skill
 for p in root.rglob('*.md'):
  if 'skills' in p.relative_to(root).parts[:-1]:
   continue  # Upstream Copies retain their own links unchanged.
  for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
   if ':' in target or target.startswith('#'):
    continue
   assert (p.parent/target.split('#')[0]).exists(), (p,target)
for skill in ('lar-shape', 'lar-build'):
 source=Path('skills')/skill
 for p in (source/'skills').rglob('*'):
  if p.is_file():
   assert p.read_bytes()==(Path('.assembled-skills')/skill/p.relative_to(source)).read_bytes(), p
PY
