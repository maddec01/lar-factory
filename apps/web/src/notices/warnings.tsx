// Active warnings on every screen. Item-source problems covered by az's fix stay hidden.

import { failedCheck } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { CLIENT_ERROR } from './dismiss-store.ts';
import { Warning } from './warning.tsx';
import { ItemSourceWarning } from './item-source-warning.tsx';
import { RepositoryConfigWarning } from './repository-config-warning.tsx';
import { AzWarning, CommandWarning, GhWarning, T3NotRunningWarning } from './tool-notices.tsx';

export function Warnings() {
  const data = useBoardStore((state) => state.data);
  const clientError = useBoardStore((state) => state.clientError);
  const t3 = failedCheck(data.tools, 't3');
  const gh = failedCheck(data.tools, 'gh');
  const az = failedCheck(data.tools, 'az');
  return (
    <>
      {clientError && (
        <Warning dismissKey={CLIENT_ERROR} what="can't reach the board server" title="Can't reach the board server.">
          {clientError} Showing the last data this page received.
        </Warning>
      )}
      {t3?.result === 'not-running' && <T3NotRunningWarning check={t3} />}
      {gh && <GhWarning check={gh} />}
      {(['git', 'jq', 'curl'] as const).map((name) => {
        const check = failedCheck(data.tools, name);
        return check && <CommandWarning key={name} name={name} check={check} />;
      })}
      {az && <AzWarning check={az} />}
      {data.repositoryConfigProblems?.map((p) => <RepositoryConfigWarning key={p.repo.toLowerCase()} {...p} />)}
      {data.itemSourceProblems?.filter((p) => !(az && p.fix === az.fix))
        .map((p) => <ItemSourceWarning key={p.repo.toLowerCase()} {...p} repos={data.repos} />)}
    </>
  );
}
