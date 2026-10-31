# Azure evidence verification

The installed azure-devops extension resolves invoke resources dynamically from the organization's resource locations (`azext_devops/dev/team/invoke.py`, lines 83–99), matching area and resource case-insensitively. Resource names therefore require live organization discovery; they are not a static installed route table.

A live invocation on this machine failed before discovery: `--organization must be specified`. `az devops configure --list` has no default organization, and this checkout has a GitHub remote. No authorized Azure organization, repository or PR was supplied. Real route discovery, authenticated reads and provider failure cases remain unverified. No credentials were created or changed.

Contracts: Microsoft Learn REST 7.1 Policy Evaluations List, Git Pull Request Statuses List and Pull Request Reviewers List. Policies use skip/top paging and the project GUID artifact identifier. Statuses and reviewers expose no paging parameters in those contracts. Preview calls pass a bare `7.1-preview`, because `az devops invoke` drops `-preview` from a versioned one.

This operation reads source commit IDs directly because T3's protocol PR context does not supply Azure policy evaluations, status contexts, reviewer votes or the Azure source commit needed to bind those observations. The readiness-view consumer belongs to #712.

The #712 readiness view uses the protected board POST route and resolves the PR from a board item, rather than accepting Azure command arguments. Opening and refreshing the view reads evidence again. Source revision and board observation changes invalidate the previous recommendation; failed reads and source disconnects withdraw it. Provider Status is never written. Controlled view fixtures exercise opening, head changes, racing responses, failed refresh and disconnect withdrawal. Live Azure policy failures, votes, head changes and disconnects remain unexercised because no Azure organization is configured on this machine.
