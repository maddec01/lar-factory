// The page: the header, the Board and Flow tabs, and the panel of the chosen view.

import { useLayoutEffect } from 'react';
import type { KeyboardEvent } from 'react';
import type { View } from '../ui-state.ts';
import { useBoardStore } from './board-store.ts';
import { BoardView } from './BoardView.tsx';
import { CopyStatus } from './CopyButton.tsx';
import { FlowView } from './FlowView.tsx';
import { Header } from './Header.tsx';
import { restoreAnchor } from './keep-anchor.ts';
import { useSetView, useView } from './router.tsx';

const VIEWS: { view: View; label: string }[] = [{ view: 'board', label: 'Board' }, { view: 'flow', label: 'Flow' }];

/** Arrow keys move to the other tab, Home and End to the first and last (WAI-ARIA tabs pattern). */
function tabFor(key: string, view: View): View | null {
  if (key === 'Home') return 'board';
  if (key === 'End') return 'flow';
  if (key === 'ArrowLeft' || key === 'ArrowRight') return view === 'board' ? 'flow' : 'board';
  return null;
}

function Tabs() {
  const view = useView();
  const setView = useSetView();
  const onKeyDown = (event: KeyboardEvent) => {
    const next = tabFor(event.key, view);
    if (!next) return;
    event.preventDefault();
    setView(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <nav className="vtabs" role="tablist" aria-label="Views">
      {VIEWS.map(({ view: v, label }) => (
        <button type="button" role="tab" className="vtab" id={`tab-${v}`} key={v} aria-controls={`panel-${v}`}
          aria-selected={view === v} tabIndex={view === v ? 0 : -1} onClick={() => setView(v)} onKeyDown={onKeyDown}>{label}</button>
      ))}
    </nav>
  );
}

export function App() {
  const view = useView();
  const data = useBoardStore((state) => state.data);
  // New data may change what's above the reading position; put it back before the browser paints.
  useLayoutEffect(restoreAnchor, [data]);
  return (
    <>
      <Header />
      <Tabs />
      <main>
        <div className="panel" role="tabpanel" id="panel-board" aria-labelledby="tab-board" hidden={view !== 'board'}>
          <BoardView />
        </div>
        <div className="panel" role="tabpanel" id="panel-flow" aria-labelledby="tab-flow" hidden={view !== 'flow'}>
          <FlowView />
        </div>
      </main>
      {/* Outside main, so the announcement sits apart from the views. */}
      <CopyStatus />
    </>
  );
}
