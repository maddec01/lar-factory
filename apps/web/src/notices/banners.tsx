// The banners above the desk: an unreachable server, which closes, then a gh the board can't use, then a missing git, jq or curl.

import { failedCheck } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { CLIENT_ERROR } from '../board/live-data.ts';
import { ClosableBanner } from './banner.tsx';
import { CommandBanner, GhBanner } from './tool-notices.tsx';

export function Banners() {
  const { data, clientError } = useBoardStore();
  const gh = failedCheck(data.tools, 'gh');
  return (
    // Hidden while empty, so it takes no gap in the page's grid.
    <div className="banners grid gap-2.5 empty:hidden">
      {clientError && (
        <ClosableBanner dismissKey={CLIENT_ERROR} what=": can't reach the board server" title="Can't reach the board server.">
          {clientError} Showing the last data this page received.
        </ClosableBanner>
      )}
      {gh && <GhBanner check={gh} />}
      {(['git', 'jq', 'curl'] as const).map((name) => {
        const check = failedCheck(data.tools, name);
        return check && <CommandBanner key={name} name={name} check={check} />;
      })}
    </div>
  );
}
