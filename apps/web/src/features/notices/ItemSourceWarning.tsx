// The warning for an onboarded repository whose items the latest read left off, such as one reading through a
// logged-out az, with the command that fixes it when one does.

import { repoName, type ItemSourceProblem, type RepoConfig } from '@lar-factory/shared';

import { CopyableCommand } from './ToolNotices';
import { Warning } from './Warning';

/** The warning names the repository as the title bar and the list modal do, among `repos`. */
export function ItemSourceWarning({ repo, problem, fix, repos }: ItemSourceProblem & { repos: readonly RepoConfig[] }) {
    return (
        <Warning
            dismissKey={`item-source:${repo.toLowerCase()}`}
            title={`${repoName(repo, repos)}’s items couldn’t be refreshed.`}
        >
            {problem}{' '}
            {fix && (
                <>
                    Run <CopyableCommand command={fix} /> in a terminal.{' '}
                </>
            )}
            The board reads it again on each refresh.
        </Warning>
    );
}
