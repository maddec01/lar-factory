// The banner for an onboarded repository the board left off because its .lar-factory.json couldn't be read,
// in repo-config.sh's words.

import type { RepositoryConfigProblem } from '@lar-factory/shared';
import { AddingARepository } from './adding-a-repository.tsx';
import { Banner } from './banner.tsx';

export function RepositoryConfigBanner({ repo, problem }: RepositoryConfigProblem) {
  return (
    <Banner title={`${repo} is off the board.`}>
      {problem.charAt(0).toUpperCase() + problem.slice(1)} <AddingARepository /> The board reads it again on each refresh.
    </Banner>
  );
}
