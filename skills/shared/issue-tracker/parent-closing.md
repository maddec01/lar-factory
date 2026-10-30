# Issue tracking

A repository's provider is its origin's host. On GitHub, use the local `gh`
login and the sections below. On Azure DevOps, use the local `az login` and
[Azure DevOps](azure-devops.md#azure-devops), which says what replaces each GitHub section.
The **factory repository**, home of the workflow,
the board and cross-repository work, is `maddec01/lar-factory`, on GitHub. Read the
destination's `AGENTS.md` and issue conventions before writing. Choose
the destination explicitly, even when the checkout belongs to another
repository:

```sh
repo=maddec01/lar-factory
gh repo view "$repo" --json nameWithOwner,url
```

Set `repo` to the repository that will own the issue, and pass `--repo "$repo"`
to issue/label commands and `repos/$repo/...` to REST calls, so nothing depends
on the checkout. For a child in another repository, select that repository and
use the parent's full URL. Confirm access with `gh auth status` when needed.

## Parent closing

The commands here are GitHub only; on Azure DevOps see [Azure parent closing](azure-devops.md#azure-parent-closing). A build closes its parent when the parent isn't a build and every other open
sub-issue of it blocks this build. Print the build's parent (or `no parent`),
whether it's a build, then the parent's other open sub-issues that don't block
this build (none printed and not a build: this build's PR closes it):

```sh
parent_url=$(gh issue view "$build" --repo "$repo" --json parent --jq '.parent.url // empty')
if [ -z "$parent_url" ]; then echo "no parent"; else
  echo "parent: $parent_url"
  gh issue view "$parent_url" --json labels --jq 'if any(.labels[]; .name == "build") then "parent is a build" else "parent is not a build" end'
  blockers=$(gh api --paginate "repos/$repo/issues/$build/dependencies/blocked_by" --jq '.[].html_url')
  gh api --paginate "repos/${parent_url#https://github.com/}/sub_issues" \
    --jq ".[] | select(.state == \"open\" and .html_url != \"https://github.com/$repo/issues/$build\") | .html_url" |
    grep -Fxv -f <(printf '%s\n' "$blockers") || true
fi
```

