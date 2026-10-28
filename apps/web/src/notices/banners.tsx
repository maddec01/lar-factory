// The banners above the desk: an unreachable server, which closes, then T3 Code not running, then a gh the board can't use,
// then a missing git, jq or curl, then an az that fails its check, then each repository whose .lar-factory.json can't be read,
// then each repository whose items are off the board, less those the az banner's fix already covers.

import { failedCheck, itemSource } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { CLIENT_ERROR } from '../board/live-data.ts';
import { ClosableBanner } from './banner.tsx';
import { ItemSourceBanner } from './item-source-banner.tsx';
import { RepositoryConfigBanner } from './repository-config-banner.tsx';
import { AzBanner, CommandBanner, GhBanner, T3NotRunningBanner } from './tool-notices.tsx';

export function Banners() {
  const { data, clientError } = useBoardStore();
  const t3 = failedCheck(data.tools, 't3');
  const gh = failedCheck(data.tools, 'gh');
  const az = failedCheck(data.tools, 'az');
  return (
    // Hidden while empty, so it takes no gap in the page's grid.
    <div className="banners grid gap-2.5 empty:hidden">
      {clientError && (
        <ClosableBanner dismissKey={CLIENT_ERROR} what=": can't reach the board server" title="Can't reach the board server.">
          {clientError} Showing the last data this page received.
        </ClosableBanner>
      )}
      {t3?.result === 'not-running' && <T3NotRunningBanner check={t3} />}
      {gh && <GhBanner check={gh} />}
      {(['git', 'jq', 'curl'] as const).map((name) => {
        const check = failedCheck(data.tools, name);
        return check && <CommandBanner key={name} name={name} check={check} />;
      })}
      {az && <AzBanner check={az} />}
      {data.repositoryConfigProblems?.map((p) => <RepositoryConfigBanner key={p.repo} {...p} />)}
      {data.itemSourceProblems?.filter((p) => !(az && p.fix === az.fix))
        .map((p) => <ItemSourceBanner key={p.repo} {...p} repos={data.repos} />)}
    </div>
  );
}
