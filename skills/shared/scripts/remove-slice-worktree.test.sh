#!/usr/bin/env bash
# Tests remove-slice-worktree.sh on a real temporary git repository, through the real
# lar-work command on a work-record database in a temporary HOME. Background processes
# stand in for T3's idle session. No T3 and no network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
script="$here/remove-slice-worktree.sh"
root=$(cd "$here/../../.." && pwd)

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# The physical path, because macOS spells mktemp's folder through a symlink.
tmp=$(cd -P "$(mktemp -d)" && pwd -P)
started=()
cleanup() {
    local pid
    for pid in ${started[@]+"${started[@]}"}; do kill -9 "$pid" 2>/dev/null || true; done
    rm -rf "$tmp"
}
trap cleanup EXIT

# lar-work runs the workspace's command, as the app's launcher runs its bundle.
bin="$tmp/bin"
mkdir -p "$bin" "$tmp/w"
cat >"$bin/lar-work" <<SH
#!/bin/sh
exec node --disable-warning=ExperimentalWarning "$root/packages/work-records/src/cli.ts" "\$@"
SH
chmod +x "$bin/lar-work"
export PATH="$bin:$PATH" HOME="$tmp/home"
export LAR_FACTORY_DATA_DIR="$HOME/Library/Application Support/Lar Factory"

revision() { lar-work read "$1" | jq -r .revision; }
make() { lar-work create --title Work --repository maddec01/lar-factory --kind "$1" | jq -r .workId; }

repo="$tmp/repo"
build_worktree="$tmp/build"
build_branch=feat/build
git init -q -b main "$repo"
git -C "$repo" config user.name Test
git -C "$repo" config user.email test@example.com
echo .env >"$repo/.gitignore"
echo one >"$repo/file"
git -C "$repo" add .
git -C "$repo" commit -qm first
old=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" worktree add -q -b "$build_branch" "$build_worktree"
echo two >"$build_worktree/file"
git -C "$build_worktree" commit -qam second

build=$(make build)
lar-work set-build-branch "$build" --revision "$(revision "$build")" --branch "$build_branch" >/dev/null

# new_slice [unfinished]: makes a slice of the build with a recorded implement thread and a worktree on its branch.
# Sets $slice, $thread, $wt and $branch.
new_slice() {
    slice=$(make slice)
    thread="thread-$slice"
    lar-work set-parent "$slice" --revision "$(revision "$slice")" --parent "$build" >/dev/null
    lar-work add-thread "$slice" --revision "$(revision "$slice")" --thread "$thread" --purpose implement >/dev/null
    [[ ${1:-} == unfinished ]] || lar-work finish "$slice" --revision "$(revision "$slice")" >/dev/null
    branch="slice/${slice:0:8}-work"
    wt="$tmp/w/${slice:0:8}"
    git -C "$repo" worktree add -q -b "$branch" "$wt" "$build_branch"
}
# judge [T3 path] [activity]: runs the script on the current slice, and sets $output, $errors and $status.
judge() { run "$build" "$slice" "$thread" "$build_worktree" "${1-$wt}" "${2:-inactive}"; }
run() {
    status=0
    output=$(bash "$script" "$@" 2>"$tmp/err") || status=$?
    errors=$(cat "$tmp/err")
}
has_branch() { git -C "$repo" show-ref --verify --quiet "refs/heads/$1"; }
# keeps <name> <text>: passes when the run exited 0 and its one line names $wt and the text, with the worktree and
# $branch still there.
keeps() {
    if ((status == 0)) && [[ -z $errors && $output == "Kept $wt: "*"$2"* && $output != *$'\n'* && -d $wt ]] && has_branch "$branch"; then
        pass "$1"
    else
        fail "$1: $status $output / $errors"
    fi
}
# removes <name>: passes when the run exited 0 and printed nothing, with the worktree and $branch gone.
removes() {
    if ((status == 0)) && [[ -z $output && -z $errors && ! -e $wt ]] && ! has_branch "$branch" &&
        ! git -C "$repo" worktree list --porcelain | grep -qxF "worktree $wt"; then
        pass "$1"
    else
        fail "$1: $status $output / $errors"
    fi
}

# start_in <folder> [ignore]: starts a process with its working directory there and sets $pid, returning once lsof
# shows it there. With ignore, it ignores the terminate signal.
start_in() {
    (
        [[ -z ${2:-} ]] || trap '' TERM
        cd "$1"
        exec sleep 300
    ) </dev/null >/dev/null 2>&1 &
    pid=$!
    started+=("$pid")
    local tries=0
    until lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | grep -qxF "n$(cd -P "$1" && pwd -P)"; do
        tries=$((tries + 1))
        ((tries < 100)) || { fail "process $pid never reached $1"; return; }
        sleep 0.05
    done
}
# reap <pid>: force-ends a test process and sets $ended to its exit status, which is 143 only if a terminate signal
# had already ended it.
reap() {
    kill -9 "$1" 2>/dev/null || true
    ended=0
    { wait "$1" || ended=$?; } 2>/dev/null
    local kept=() other
    for other in "${started[@]}"; do [[ $other == "$1" ]] || kept+=("$other"); done
    started=(${kept[@]+"${kept[@]}"})
}

new_slice
echo SECRET=1 >"$wt/.env"
mkdir "$wt/sub" "$wt-2"
start_in "$wt/sub"
inside=$pid
start_in "$wt-2"
neighbour=$pid
# Bash reports the terminated job on stderr at its next command.
{
    judge
    removes "a finished, inactive, clean, integrated worktree goes with its branch, gitignored files included"
} 2>/dev/null
reap "$inside"
if ((ended == 143)); then
    pass "a process with its working directory inside the worktree gets a terminate signal"
else
    fail "a process with its working directory inside the worktree gets a terminate signal: exit $ended"
fi
if kill -0 "$neighbour" 2>/dev/null && [[ -d $wt-2 ]]; then
    pass "a process in a folder whose name only starts with the worktree's path is left alone"
else
    fail "a process in a folder whose name only starts with the worktree's path is left alone"
fi
reap "$neighbour"

judge
removes "a path git no longer lists prints nothing, as T3 keeps reporting it after removal"
judge "$wt" "T3 is unavailable"
removes "a path git no longer lists prints nothing, whatever T3 says"

ln -s "$tmp/w" "$tmp/link"
new_slice
judge "$tmp/link/${slice:0:8}"
removes "T3 may spell the worktree's path through a symlink"
new_slice
run "$build" "$slice" "$thread" "$tmp/link/../build" "$wt" inactive
removes "the builder may spell the build worktree's path through a symlink"

new_slice
first_thread=$thread first_wt=$wt first_branch=$branch
echo three >"$wt/file"
git -C "$wt" commit -qam restarted
judge
keeps "commits outside the build branch keep the worktree" "commits outside"
branch="$first_branch-2" wt="$first_wt-2" thread="$first_thread-2"
git -C "$repo" worktree add -q -b "$branch" "$wt" "$old"
lar-work add-thread "$slice" --revision "$(revision "$slice")" --thread "$thread" --purpose implement >/dev/null
judge
removes "a restarted attempt with no commits outside the build branch goes, judged apart from the first attempt"
if [[ -d $first_wt ]] && has_branch "$first_branch"; then
    pass "removing one attempt leaves the slice's other attempt"
else
    fail "removing one attempt leaves the slice's other attempt"
fi

new_slice
echo changed >"$wt/file"
judge
keeps "a modified file keeps the worktree" "it has modified or untracked"

new_slice
echo new >"$wt/new"
git -C "$wt" config status.showUntrackedFiles no
judge
git -C "$wt" config --unset status.showUntrackedFiles
keeps "an untracked file keeps the worktree, whatever git's status settings say" "it has modified or untracked"

new_slice
judge "$wt" "T3 shows an active run"
keeps "T3 not showing the thread inactive keeps the worktree, with T3's reason" "T3 shows an active run"

new_slice
judge "" "T3 is unavailable"
if ((status == 0)) && [[ $output == *"$thread"*"T3 is unavailable"* && -d $wt ]] && has_branch "$branch"; then
    pass "an unreadable T3 thread keeps the worktree and names the thread"
else
    fail "an unreadable T3 thread keeps the worktree and names the thread: $status $output / $errors"
fi
judge ""
if ((status == 0)) && [[ $output == *"$thread"*"no worktree path"* && -d $wt ]]; then
    pass "a thread T3 gives no path for keeps the worktree"
else
    fail "a thread T3 gives no path for keeps the worktree: $status $output / $errors"
fi

new_slice unfinished
judge
keeps "an unfinished slice keeps the worktree" "isn't finished"

new_slice
other=$(make build)
run "$other" "$slice" "$thread" "$build_worktree" "$wt" inactive
keeps "a slice of another build keeps the worktree" "doesn't belong"

new_slice
run "$build" "$slice" "thread-unrecorded" "$build_worktree" "$wt" inactive
keeps "a thread the slice hasn't recorded keeps the worktree" "recorded implement thread"
lar-work add-thread "$slice" --revision "$(revision "$slice")" --thread thread-review --purpose review >/dev/null
run "$build" "$slice" thread-review "$build_worktree" "$wt" inactive
keeps "a thread recorded for another purpose keeps the worktree" "recorded implement thread"

new_slice
lar-work confirm-thread-deleted "$slice" --revision "$(revision "$slice")" --thread "$thread" >/dev/null
judge
keeps "an implement thread whose record has deletedAt set keeps the worktree" "recorded implement thread"

new_slice
branch=other/name
git -C "$wt" switch -qc "$branch"
judge
keeps "a branch named for no slice keeps the worktree" "isn't on a branch named for"
new_slice
git -C "$wt" switch -q --detach
judge
keeps "a detached worktree stays" "isn't on a branch named for"

new_slice
sibling_wt=$wt sibling_branch=$branch
new_slice
wt=$sibling_wt branch=$sibling_branch
judge
keeps "a path on a sibling slice's branch keeps the worktree" "isn't on a branch named for"

new_slice
git -C "$build_worktree" switch -q --detach
judge
git -C "$build_worktree" switch -q "$build_branch"
keeps "a build worktree off the record's branch keeps the worktree" "isn't on $build_branch"

run "$build" "$slice" "$thread" "$tmp/w" "$wt" inactive
keeps "a build worktree outside the repository keeps the worktree" "can't list worktrees"

run "$build" "$slice" "$thread" "$tmp/missing" "$wt" inactive
keeps "a build worktree that doesn't exist keeps the worktree" "can't enter"

new_slice
judge "$repo"
if ((status == 0)) && [[ $output == "Kept $repo: "*"main checkout"* && -e $repo/.git ]]; then
    pass "the main checkout is refused"
else
    fail "the main checkout is refused: $status $output / $errors"
fi
judge "$build_worktree"
if ((status == 0)) && [[ $output == "Kept $build_worktree: "*"build worktree"* && -e $build_worktree/.git ]]; then
    pass "the build worktree is refused"
else
    fail "the build worktree is refused: $status $output / $errors"
fi

new_slice
nested="$wt/nested"
git -C "$repo" worktree add -q -b "nested-${slice:0:8}" "$nested" "$build_branch"
git -C "$wt" config core.excludesFile "$tmp/ignore-nested"
echo nested/ >"$tmp/ignore-nested"
judge
git -C "$wt" config --unset core.excludesFile
keeps "a worktree holding another worktree stays" "$nested"

fake="$tmp/fake"
mkdir "$fake"
printf '#!/bin/sh\nexit 1\n' >"$fake/lsof"
chmod +x "$fake/lsof"
new_slice
PATH="$fake:$PATH" judge
keeps "a process-table read that fails keeps the worktree" "process table"
printf '#!/bin/sh\nexit 0\n' >"$fake/lsof"
PATH="$fake:$PATH" judge
keeps "a process-table read that lists nothing keeps the worktree" "process table"
rm "$fake/lsof"

printf '#!/bin/sh\nexit 1\n' >"$fake/lar-work"
chmod +x "$fake/lar-work"
PATH="$fake:$PATH" judge
keeps "records it can't read keep the worktree" "can't read"
rm "$fake/lar-work"

new_slice
start_in "$wt" ignore
survivor=$pid
judge
keeps "a process that survives the terminate signal keeps the worktree" "PID $survivor"
reap "$survivor"
judge
removes "the next pass removes the worktree once its survivor has gone"

new_slice
git -C "$repo" worktree lock "$wt"
start_in "$wt"
holder=$pid
judge
keeps "a locked worktree stays" "it is locked"
reap "$holder"
if ((ended == 137)); then
    pass "a process inside a locked worktree gets no terminate signal"
else
    fail "a process inside a locked worktree gets no terminate signal: exit $ended"
fi

new_slice
git -C "$repo" worktree lock --reason "held for a test" "$wt"
start_in "$wt"
holder=$pid
judge
keeps "a worktree locked with a reason stays" "it is locked"
reap "$holder"
if ((ended == 137)); then
    pass "a process inside a worktree locked with a reason gets no terminate signal"
else
    fail "a process inside a worktree locked with a reason gets no terminate signal: exit $ended"
fi

real_git=$(command -v git)
cat >"$fake/git" <<SH
#!/bin/sh
if [ "\$1 \$2" = "worktree remove" ]; then
    echo "fatal: refused" >&2
    exit 1
fi
exec "$real_git" "\$@"
SH
chmod +x "$fake/git"
new_slice
PATH="$fake:$PATH" judge
keeps "a failed removal keeps the branch and reports the reason" "couldn't remove it: fatal: refused"
rm "$fake/git"

new_slice
git -C "$repo" branch "upstream-${slice:0:8}" "$old"
git -C "$repo" branch -q --set-upstream-to="upstream-${slice:0:8}" "$branch"
judge
if ((status == 0)) && [[ $output == "Removed $wt, kept branch $branch: "* && $output != *$'\n'* && ! -e $wt ]] && has_branch "$branch"; then
    pass "a failed branch delete reports the reason, with the worktree gone"
else
    fail "a failed branch delete reports the reason, with the worktree gone: $status $output / $errors"
fi

for args in "$build $slice" "$build $slice $thread $build_worktree $wt inactive extra"; do
    # shellcheck disable=SC2086
    run $args
    if ((status == 2)) && [[ -z $output && $errors == *"usage: remove-slice-worktree.sh"* ]]; then
        pass "wrong usage exits 2 and shows the usage: $(wc -w <<<"$args" | tr -d ' ') arguments"
    else
        fail "wrong usage exits 2 and shows the usage: $status $output / $errors"
    fi
done
run "$build" "$slice" "$thread" "$build_worktree" "$wt" ""
if ((status == 2)); then
    pass "an empty T3 answer is wrong usage"
else
    fail "an empty T3 answer is wrong usage: $status $output / $errors"
fi

((failures == 0))
