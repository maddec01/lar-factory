// The page: the title bar, then the header and the Board view; or, while no t3 is found, the title bar above the
// notice that replaces the rest.

import { useLayoutEffect } from 'react';
import { AbandonDialog } from './items/abandon-dialog.tsx';
import { useBoardStore } from './board/board-store.ts';
import { BoardView } from './board/board-view.tsx';
import { CopyStatus } from './copy/copy-button.tsx';
import { Header } from './board/header.tsx';
import { restoreAnchor } from './board/keep-anchor.ts';
import { Toasts } from './notices/toasts.tsx';
import { TitleBar } from './title-bar/TitleBar.tsx';
import { T3Missing } from './notices/tool-notices.tsx';

export function App() {
  const data = useBoardStore((state) => state.data);
  // New data may change what's above the reading position; put it back before the browser paints.
  useLayoutEffect(restoreAnchor, [data]);
  if (data.tools?.t3) return <><TitleBar /><T3Missing problem={data.tools.t3} /></>;
  return (
    <>
      <TitleBar />
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
