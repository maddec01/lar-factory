// The page: in the Mac app the title bar, then the header and the Board view; or, while no t3 is found, the notice that
// replaces them.

import { useLayoutEffect } from 'react';
import { AbandonDialog } from './AbandonDialog.tsx';
import { inMacApp } from './board-app.ts';
import { useBoardStore } from './board-store.ts';
import { BoardView } from './BoardView.tsx';
import { CopyStatus } from './CopyButton.tsx';
import { Header } from './Header.tsx';
import { restoreAnchor } from './keep-anchor.ts';
import { Toasts } from './Toasts.tsx';
import { TitleBar } from './TitleBar.tsx';
import { T3Missing } from './ToolNotices.tsx';

export function App() {
  const data = useBoardStore((state) => state.data);
  // New data may change what's above the reading position; put it back before the browser paints.
  useLayoutEffect(restoreAnchor, [data]);
  const titleBar = inMacApp() && <TitleBar />;
  if (data.tools?.t3) return <>{titleBar}<T3Missing problem={data.tools.t3} /></>;
  return (
    <>
      {titleBar}
      <Header />
      <main>
        <div id="panel-board">
          <BoardView />
        </div>
      </main>
      {/* Outside main, so the announcement sits apart from the Board view. */}
      <CopyStatus />
      <Toasts />
      <AbandonDialog />
    </>
  );
}
