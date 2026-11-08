import { onAzure, type OperationAccess, type RepositoryOperation } from './model.ts';
import { trackerCapabilities } from './tracker-capabilities.ts';

/** Returns the reason a write is denied, or null after verified access and safety checks pass. */
export function writeAccessProblem(
    repo: string,
    operation: RepositoryOperation,
    access: Partial<Record<RepositoryOperation, OperationAccess>>,
    options: { azureReadOnly?: boolean; fineGrainedToken?: boolean; recheckAction?: boolean } = {},
): string | null {
    const recheck = options.recheckAction ? '' : ' Recheck access in Settings.';

    if (onAzure(repo)) {
        if (
            options.azureReadOnly ??
            (typeof process !== 'undefined' && process.env.LAR_FACTORY_AZURE_READ_ONLY === '1')
        )
            return 'Azure DevOps is read-only in this test session.';
    }

    if (access[operation] === 'refused') return `Access to ${operation} was refused.${recheck}`;

    if (access[operation] === 'allowed') return null;

    if (!onAzure(repo) && options.fineGrainedToken)
        return 'This GitHub login doesn’t let the board confirm write access. Sign in with repository write access, then recheck access.';

    if (!onAzure(repo) && operation === 'edit-ticket' && access['push-branch'] !== 'allowed')
        return `This login can’t edit other people’s issues without verified push access.${recheck}`;

    return `Access to ${operation} isn’t checked yet.${!onAzure(repo) ? ' Sign in to GitHub with repository write access to confirm permissions.' : ''}${recheck}`;
}

/** Returns the reason the factory can't create a new label by itself, or null when it can. */
export function newLabelProblem(
    repo: string,
    access: Partial<Record<RepositoryOperation, OperationAccess>>,
    options: { azureReadOnly?: boolean } = {},
): string | null {
    return writeAccessProblem(repo, 'manage-labels', access, options) ?? trackerCapabilities(repo).createUnavailable;
}

/** Saved preferences remain intact when access prevents their use. */
export function effectiveIssueSettings(
    setup: Pick<
        import('./model.ts').RepositorySetup,
        'repo' | 'access' | 'azureReadOnly' | 'createIssuesFromAddItem' | 'createIssuesFromRetro' | 'writeRefinedSpec'
    >,
    options: { azureReadOnly?: boolean } = {},
) {
    const azureReadOnly = options.azureReadOnly ?? setup.azureReadOnly;
    const safety = azureReadOnly === undefined ? {} : { azureReadOnly };
    const createReason = writeAccessProblem(setup.repo, 'publish-ticket', setup.access, safety);
    const specReason = writeAccessProblem(setup.repo, 'edit-ticket', setup.access, safety);

    return {
        createIssuesFromAddItem: (setup.createIssuesFromAddItem ?? true) && createReason === null,
        createIssuesFromRetro: (setup.createIssuesFromRetro ?? true) && createReason === null,
        writeRefinedSpec: (setup.writeRefinedSpec ?? true) && specReason === null,
        createReason,
        specReason,
    };
}
