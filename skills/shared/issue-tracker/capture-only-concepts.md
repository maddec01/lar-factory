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

## Capture-only Concepts

Follow [Retro capture](../retro-capture.md), with its persisted plan, stable
selection IDs, reconciliation and visibility rules. A selected suggestion
spanning repositories goes to the factory repository, even when the source
issue and checkout are in another repository. Run label setup there after
persisting the plan and before creating a missing concept.

This path creates or reuses only the concept map: the `concept` label and the
sections in [Concepts](../../concepts.md), affected repositories in Destination, and
decomposition left in Fog with no sub-issues yet. Retain the URL and put a new
concept in List; keep a reused concept's status and the source issue's final
status. Decisions, native sub-issues and blocked-by edges come later in
shaping; run none of the mutation examples above during capture.

