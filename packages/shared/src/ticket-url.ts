// A ticket's page on its tracker, built from the ticket's repository key and number. It imports neither
// tracker-capabilities.ts nor tracker-structure.ts, so both use it without importing each other.

/** Whether a repository is on Azure DevOps: organization/project/repository, not GitHub's owner/name. */
export const onAzure = (repo: string): boolean => repo.split('/').length === 3;

/** A GitHub issue's page; `repository` is `owner/name`. */
export const githubTicketUrl = (repository: string, number: number): string =>
    `https://github.com/${repository}/issues/${number}`;

/** An Azure DevOps work item's page; `repository` is `organization/project/name`, its project encoded as the key keeps it. */
export const azureTicketUrl = (repository: string, number: number): string => {
    const [organization, project] = repository.split('/');

    return `https://dev.azure.com/${organization}/${project}/_workitems/edit/${number}`;
};

/** The page of ticket `number` in the tracker holding `repository`. */
export const ticketUrl = (repository: string, number: number): string =>
    (onAzure(repository) ? azureTicketUrl : githubTicketUrl)(repository, number);
