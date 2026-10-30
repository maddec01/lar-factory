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

## Native relationships

GitHub only; on Azure DevOps see [Children and blockers](azure-devops.md#children-and-blockers). Check `gh issue create --help` and `gh issue edit --help` for `--parent`,
`--add-sub-issue` and `--add-blocked-by`. Replace the example issue numbers
(in `$repo`) before running; use full issue URLs for cross-repository parents or
blockers, and `--body-file` for multiline bodies.

```sh
parent=100
child=101
blocker=102
child_repo=$repo

# Create a decision as a native sub-issue; retain the returned URL immediately.
# Slices are created with slice.sh instead (see Slices).
gh issue create --repo "$repo" --title "Decide the approach" \
  --body-file /path/to/decision.md --label "decision-grill" --parent "$parent"

# Or attach an existing child to the map.
gh issue edit "$parent" --repo "$repo" --add-sub-issue "$child"

# The child waits for the blocker, not the other way around.
gh issue edit "$child" --repo "$repo" --add-blocked-by "$blocker"
```

Without those flags, use the REST equivalents below. URL/path issue numbers
(`100`, `101`, `102`) differ from numeric REST database IDs (`.id`), and
`gh issue view --json id` returns a GraphQL node ID: pass only `.id` to these
REST mutations.

```sh
child_repo=$repo
blocker_repo=$repo
# For cross-repository relationships, change child_repo/blocker_repo explicitly.
child_id=$(gh api "repos/$child_repo/issues/$child" --jq '.id')
blocker_id=$(gh api "repos/$blocker_repo/issues/$blocker" --jq '.id')

gh api --method POST "repos/$repo/issues/$parent/sub_issues" \
  -F sub_issue_id="$child_id"
gh api --method POST "repos/$child_repo/issues/$child/dependencies/blocked_by" \
  -F issue_id="$blocker_id"
```

`-F` sends the IDs as JSON numbers. Verify the relationships with read-only
calls, also before retrying a failed or uncertain mutation:

```sh
gh api --paginate "repos/$repo/issues/$parent/sub_issues" \
  --jq '.[] | {number, id, html_url}'
gh api --paginate "repos/$child_repo/issues/$child/dependencies/blocked_by" \
  --jq '.[] | {number, id, html_url, state}'
```

Confirm the intended child's and blocker's URLs appear; a `Part of #n` mention
or Mermaid edge creates neither relationship. If a write fails, inspect the
existing relationships before retrying, and surface permission, validation and
conflicting-parent errors instead of falling back to mentions.

REST reference: GitHub's [sub-issues API](https://docs.github.com/en/rest/issues/sub-issues)
and [issue dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies).

