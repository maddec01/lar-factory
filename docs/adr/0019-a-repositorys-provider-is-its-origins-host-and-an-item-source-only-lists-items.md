# A repository's provider is its origin's host, and an item source only lists items

Settled in [#359's decision](https://github.com/maddec01/lar-factory/issues/359#issuecomment-6400801376).

A repository's tickets live on the provider that hosts its git origin, GitHub or Azure DevOps, so config never names a provider, and a GitHub repository whose tickets sit in Azure Boards is not supported. Each repository reads its GitHub issues or an Azure team's backlog and current sprint together, and that source decides only which items show: every item carries its own repository, status and links. That lets repositories share one source and lets an item exist before its repository is known, at the cost of writing the repository onto each item at shaping.
