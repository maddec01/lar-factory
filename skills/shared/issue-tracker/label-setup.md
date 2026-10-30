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

## Label setup

GitHub only: Azure DevOps creates a tag the first time an item gets it. Run this block once per destination, before applying workflow labels or
creating labelled issues. It needs permission to manage the destination's
labels, creates only missing ones (existing names, colours and descriptions stay
intact), and exits nonzero on any read or creation failure.

```bash
(
  set -euo pipefail
  : "${repo:?Set repo to the destination owner/repo first}"
  existing=$(gh api --paginate "repos/$repo/labels" --jq '.[].name')
  while IFS='|' read -r name color description; do
    if grep -Fxq -- "$name" <<<"$existing"; then
      continue
    fi
    gh label create "$name" --repo "$repo" \
      --color "$color" --description "$description"
  done <<'LABELS'
bug|D73A4A|Something broken
feature|A2EEEF|New behaviour
improvement|1D76DB|Better existing behaviour
concept|5319E7|A map of work needing decisions and builds
decision-grill|D4C5F9|Concept decision settled by questions
decision-prototype|D4C5F9|Concept decision settled by a prototype
decision-research|D4C5F9|Concept decision settled by research
decision-task|D4C5F9|Concept decision settled by a small task
build|0E8A16|Issue that becomes one PR
active|FBCA04|Slice an implementer is working on now
blocked|BFD4F2|Slice an implementer couldn't finish, waiting for a re-slice
LABELS
)
```

On failure, fix the reported access/network/API problem and rerun the whole
block for the same destination; it skips completed creations. It never updates
an existing label: a changed description (such as `build`'s) is a one-off
`gh label edit "$name" --repo "$repo" --description "<new>"`. Never add
`--force`, delete existing labels or suppress errors to make setup pass. Confirm
the result:

```sh
gh api --paginate "repos/$repo/labels" --jq '.[].name'
```

All eleven names above must be present. The block doesn't create the
`status-<name>` labels: `status.sh` and the board create each one when it's
first needed.

