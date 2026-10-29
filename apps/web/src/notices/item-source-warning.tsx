// The warning for an onboarded repository whose items the latest read left off, such as one reading through a
// logged-out az, with the command that fixes it when one does.

import { repoName, type ItemSourceProblem, type RepoConfig } from '@lar-factory/shared';
import { Warning } from './warning.tsx';
import { CopyableCommand } from './tool-notices.tsx';

/** The warning names the repository as the title bar and the List modal do, among `repos`. */
export function ItemSourceWarning({ repo, problem, fix, repos }: ItemSourceProblem & { repos: readonly RepoConfig[] }) {
  return (
    <Warning dismissKey={`item-source:${repo.toLowerCase()}`} title={`${repoName(repo, repos)}'s items are off the board.`}>
      {problem} {fix && <>Run <CopyableCommand command={fix} /> in a terminal. </>}The board reads it again on each refresh.
    </Warning>
  );
}
