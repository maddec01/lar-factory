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

## Status

Status lives on the item. The statuses are List, Queued, Shaping, Needs you,
Ready, In progress, Review, Verify, Ready to merge and Done. A repository's
`.lar-factory.json` names its item source. GitHub issues keep their status as
`status-<name>` labels, and an Azure DevOps
work item as `status-<name>` tags: the status lowercased with
hyphens for spaces, such as `status-shaping` or `status-ready-to-merge`. An issue carries one. No write
stores Done: closing the issue, or moving the work item to a Completed-category
State, makes it Done.

Move an item with `bash <this skill>/shared/scripts/status.sh <issue-url> "<Status>"`
as the workflow directs, passing a work item's URL on Azure DevOps. It swaps the
issue's label or the work item's tag. On a work
item it also moves State when the state category changes: the first
InProgress-category state for any status after Queued, the first
Proposed-category state for List or Queued. It refuses Done, a pull request,
and an issue with two status labels until someone removes all but one.

