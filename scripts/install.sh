#!/usr/bin/env bash
# Installs or updates the factory's skills and the shared checklists they link to.
# Run from a clone of main: bash scripts/install.sh
# Skills and checklists come from main on GitHub, not from this checkout; only the
# skill list is read locally, from UPSTREAM.md, so pull main first.
set -euo pipefail

REPO=maddec01/mux-factory
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Mux's own skills; every other skill is a copy listed in UPSTREAM.md.
OWN_SKILLS=(mux-work skill-sync)

# Skills whose copies link to ../../references/.
CHECKED_SKILLS=(
  code-review-and-quality security-and-hardening
  frontend-ui-engineering doubt-driven-development
)

# Agents resolve ../../references from their own skills folder:
# Codex from ~/.agents/skills, Claude Code from ~/.claude/skills.
reference_dirs() {
  printf '%s\n' "$1/.agents/references" "$1/.claude/references"
}

# Prints the name of every skill row in an UPSTREAM.md, skipping references/ rows.
upstream_skills() {
  awk -F'|' '/^\| `/ && $4 !~ /`references\// { gsub(/[ `]/, "", $2); print $2 }' "$1"
}

die() {
  printf 'install: %s\n' "$*" >&2
  exit 1
}

# Replaces both references folders with every file in references/ on main.
install_references() {
  staging=$(mktemp -d)
  trap 'rm -rf "$staging"' EXIT

  printf 'Fetching checklists from %s main...\n' "$REPO"
  local names
  names=$(gh api "repos/$REPO/contents/references?ref=main" \
    --jq '.[] | select(.type == "file") | .name') ||
    die "couldn't list references/ on $REPO main; skills are updated, checklists unchanged; run again"
  [[ -n $names ]] || die "no files in references/ on $REPO main"

  local name
  while IFS= read -r name; do
    [[ $name =~ ^[A-Za-z0-9._-]+$ && $name != .* ]] || die "unexpected file name in references/: $name"
    gh api -H 'Accept: application/vnd.github.raw' \
      "repos/$REPO/contents/references/$name?ref=main" >"$staging/$name" ||
      die "couldn't fetch references/$name; skills are updated, checklists unchanged; run again"
  done <<<"$names"

  local target
  while IFS= read -r target; do
    rm -rf "$target"
    mkdir -p "$target"
    cp "$staging"/* "$target"/
    printf 'Replaced %s with %d checklists\n' "$target" "$(wc -l <<<"$names" | tr -d ' ')"
  done < <(reference_dirs "$HOME")
}

# Collapses . and .. in an absolute path without following symlinks.
normalize() {
  local part
  local -a parts=() kept=()
  IFS=/ read -ra parts <<<"$1"
  for part in "${parts[@]}"; do
    case $part in
      '' | .) ;;
      ..) ((${#kept[@]})) && unset 'kept[${#kept[@]}-1]' ;;
      *) kept+=("$part") ;;
    esac
  done
  local IFS=/
  printf '/%s' "${kept[*]}"
}

# Prints every ../ path in a Markdown file: `../x` code spans and [t](../x) links.
relative_paths() {
  grep -oE '`\.\./[^`]*`|\]\(\.\./[^) ]*' "$1" | sed -E 's/^`//; s/`$//; s/^\]\(//' || true
}

# Checks that every ../ path in each installed copy of CHECKED_SKILLS resolves,
# under both ~/.agents/skills and ~/.claude/skills, taken literally.
check_references() {
  local home=$1 broken=0 skills_dir name dir file path target count
  for skills_dir in "$home/.agents/skills" "$home/.claude/skills"; do
    for name in "${CHECKED_SKILLS[@]}"; do
      dir="$skills_dir/$name"
      if [[ ! -d $dir ]]; then
        printf 'missing skill: %s\n' "$dir" >&2
        broken=1
        continue
      fi
      count=0
      while IFS= read -r file; do
        while IFS= read -r path; do
          [[ -n $path ]] || continue
          count=$((count + 1))
          target=$(normalize "$(dirname "$file")/${path%%#*}")
          if [[ ! -f $target ]]; then
            printf 'broken: %s: %s (%s)\n' "$file" "$path" "$target" >&2
            broken=1
          fi
        done < <(relative_paths "$file")
      done < <(find -L "$dir" -name '*.md' -type f)
      if ((count == 0)); then
        printf 'no ../ paths found in %s\n' "$dir" >&2
        broken=1
      fi
    done
  done
  ((broken == 0)) || return 1
  printf 'Every checklist link resolves.\n'
}

main() {
  command -v npx >/dev/null || die "needs npx (install Node.js)"
  command -v gh >/dev/null || die "needs gh (install GitHub CLI)"
  gh auth status >/dev/null 2>&1 || die "needs a gh login (gh auth login) to fetch references/"
  local -a skills=("${OWN_SKILLS[@]}")
  local name
  while IFS= read -r name; do
    skills+=("$name")
  done < <(upstream_skills "$ROOT/UPSTREAM.md")
  ((${#skills[@]} > ${#OWN_SKILLS[@]})) || die "no skill rows in $ROOT/UPSTREAM.md"
  npx --yes skills add "$REPO" -g -a claude-code codex -s "${skills[@]}" -y
  install_references
  check_references "$HOME" || die "some checklist links don't resolve; check that references/ on main has the files named above, then run again"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
