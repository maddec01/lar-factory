#!/bin/bash
# Usage: remove-slice-worktree.sh <build> <slice> <thread> <build worktree> <T3 worktree path> <inactive | reason>
# Judges one recorded implement thread of a finished slice, and removes its worktree and
# slice branch when that is provably safe. Only the agent can read T3, so the caller
# passes what T3 says: the thread's worktree path, empty when T3 gave none, then
# "inactive" when T3 shows no active run, pending request or running descendant, or
# otherwise the reason it doesn't or couldn't be read. The rest comes from lar-work, git
# and the process table.
# A path git no longer lists prints nothing, because T3 keeps reporting it after removal.
# Every worktree that stays prints one line naming its path and the reason, and any
# check it can't read keeps the worktree. Every such case exits 0 so the build continues.
# Only wrong usage exits nonzero, with 2.
set -euo pipefail

usage="usage: remove-slice-worktree.sh <build> <slice> <thread> <build worktree> <T3 worktree path> <inactive | reason>"
if (($# != 6)) || [[ -z $1 || -z $2 || -z $3 || -z $4 || -z $6 ]]; then
    echo "$usage" >&2
    exit 2
fi
build=$1 slice=$2 thread=$3 t3_activity=$6

keep() {
    printf 'Kept %s: %s\n' "$target" "${1//$'\n'/ }"
    exit 0
}

# physical <path>: prints the path with symlinks resolved, as far as its folders exist. T3, git and lsof can spell one
# path differently.
physical() {
    local dir
    if dir=$(cd -P -- "$1" 2>/dev/null && pwd -P); then
        echo "$dir"
    else
        dir=$(physical "$(dirname -- "$1")")
        echo "${dir%/}/$(basename -- "$1")"
    fi
}

if [[ -z $5 ]]; then
    target="the worktree of thread $thread"
    [[ $t3_activity != inactive ]] || keep "T3 gave no worktree path"
    keep "$t3_activity"
fi
target=$(physical "$5")
build_worktree=$(physical "$4")
# git branch -d tests the merge against this HEAD, and this shell must not sit in the worktree it removes.
cd -- "$build_worktree" 2>/dev/null || keep "can't enter the build worktree $build_worktree"
listing=$(git worktree list --porcelain 2>/dev/null) || keep "git can't list worktrees from $build_worktree"

main="" listed=false locked=false nested="" slice_branch="" build_head=""
while IFS= read -r line; do
    case $line in
    "worktree "*)
        path=$(physical "${line#worktree }")
        [[ -n $main ]] || main=$path
        [[ $path != "$target" ]] || listed=true
        [[ $path != "$target/"* ]] || nested=$path
        ;;
    "branch refs/heads/"*)
        [[ $path != "$target" ]] || slice_branch=${line#branch refs/heads/}
        [[ $path != "$build_worktree" ]] || build_head=${line#branch refs/heads/}
        ;;
    locked | "locked "*)
        [[ $path != "$target" ]] || locked=true
        ;;
    esac
done <<<"$listing"

$listed || exit 0
[[ $target != "$main" ]] || keep "it is the main checkout"
[[ $target != "$build_worktree" ]] || keep "it is the build worktree"
[[ -z $nested ]] || keep "it holds another worktree, $nested"
[[ -d $target ]] || keep "git lists it, but its folder is missing"
# Git refuses to remove a locked worktree, so finding this first spares its processes the terminate signal.
! $locked || keep "it is locked"

# Owned.
record=$(lar-work read "$slice" 2>/dev/null) || keep "can't read slice $slice"
jq -e --arg build "$build" '.kind == "slice" and .parentId == $build' <<<"$record" >/dev/null 2>&1 ||
    keep "slice $slice doesn't belong to build $build"
jq -e '.finishedAt != null' <<<"$record" >/dev/null 2>&1 || keep "slice $slice isn't finished"
threads=$(lar-work threads "$slice" 2>/dev/null) || keep "can't read the threads of slice $slice"
jq -e --arg thread "$thread" 'any(.[]; .threadId == $thread and .purpose == "implement" and .deletedAt == null)' \
    <<<"$threads" >/dev/null 2>&1 || keep "thread $thread isn't a recorded implement thread of slice $slice"
[[ $slice_branch == "slice/${slice:0:8}-"* ]] || keep "it isn't on a branch named for slice $slice"
build_branch=$(lar-work read "$build" 2>/dev/null | jq -er .buildBranch 2>/dev/null) ||
    keep "can't read the branch of build $build"
[[ $build_head == "$build_branch" ]] || keep "the build worktree $build_worktree isn't on $build_branch"

# Inactive.
[[ $t3_activity == inactive ]] || keep "$t3_activity"

# Clean. Gitignored files don't count, as git worktree remove doesn't count them.
changes=$(git -C "$target" status --porcelain --untracked-files=normal --ignore-submodules=none 2>/dev/null) ||
    keep "can't read its git status"
[[ -z $changes ]] || keep "it has modified or untracked files"

# Integrated.
integrated=0
git merge-base --is-ancestor "refs/heads/$slice_branch" "refs/heads/$build_branch" 2>/dev/null || integrated=$?
case $integrated in
0) ;;
1) keep "$slice_branch has commits outside $build_branch" ;;
*) keep "can't compare $slice_branch with $build_branch" ;;
esac

# read_processes: sets $inside to the PIDs whose working directory is the target or under it. lsof's exit status can't
# prove a read on its own, so a listing that leaves out this script counts as failed.
read_processes() {
    local listing line pid="" name found_self=false
    inside=""
    listing=$(lsof -w -nP -d cwd -Fpn 2>/dev/null) || return 1
    while IFS= read -r line; do
        case $line in
        p*)
            pid=${line#p}
            [[ $pid != "$$" ]] || found_self=true
            ;;
        n*)
            name=${line#n}
            if [[ $name == "$target" || $name == "$target/"* ]]; then inside+=" $pid"; fi
            ;;
        esac
    done <<<"$listing"
    $found_self
}

# Signal each PID once, then read the table again, so a process that started during the wait gets its signal too.
signalled=" "
deadline=$((SECONDS + 5))
while :; do
    read_processes || keep "can't read the process table"
    [[ -n $inside ]] || break
    ((SECONDS < deadline)) || keep "PID$inside survived a terminate signal"
    for pid in $inside; do
        case $signalled in
        *" $pid "*) ;;
        *)
            kill -TERM "$pid" 2>/dev/null || true
            signalled+="$pid "
            ;;
        esac
    done
    sleep 0.2
done

error=$(git worktree remove -- "$target" 2>&1) || keep "couldn't remove it: ${error%%$'\n'*}"
if ! error=$(git branch -d -- "$slice_branch" 2>&1); then
    printf 'Removed %s, kept branch %s: %s\n' "$target" "$slice_branch" "${error%%$'\n'*}"
fi
