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
import hashlib
import re
stages=Path('skills/stages/shaping')
assert {p.name for p in stages.iterdir()} == {
 'concepts.md', 'diagnose-bug.md', 'grilling-with-docs.md',
 'prototype-logic.md', 'prototype-question.md', 'prototype-ui.md',
 'research-question.md', 'start-build.md',
 'pick-up.md', 'size-up.md', 'brief.md', 'gate.md', 'doubt.md', 'decisions.md',
}
pick_up=(stages/'pick-up.md').read_text()
assert 'Do not search for repository guidance or config files' in pick_up
assert 'Read existing project instructions when present' not in pick_up
def hashes(root):
 return {p.relative_to(root): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in root.rglob('*') if p.is_file()}
for skill in ('lar-shape', 'lar-build'):
 source=Path('skills')/skill
 assert not any((source/p.name).exists() for p in stages.iterdir()), skill
 expected=hashes(source)
 expected.update(hashes(stages))
 expected.update({Path('shared')/p: digest for p, digest in hashes(Path('skills/shared')).items()})
 assert hashes(Path('.assembled-skills')/skill)==expected, skill
 assert hashes(Path('.assembled-skills/skills')/skill)==expected, skill
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
# Packaged installs ship only lar's own skills, even after an earlier run assembled another.
mkdir -p .assembled-skills/skills/lar-work
node scripts/assemble-skills.mjs
test "$(ls -A .assembled-skills/skills | tr '\n' ' ')" = "lar-build lar-shape "
