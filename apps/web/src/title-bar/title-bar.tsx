// The main area's title bar: a 52 px drag bar with the scope ("Whole factory", or the repository the sidebar scoped
// it to, with an × to clear it), the Refreshed time, the counters and This week. While the sidebar is closed it starts
// past the window controls. Clicks on its buttons never drag the window; the rest of the bar does.
// Above the missing-t3 notice there's no board to scope or count, so the bar is empty.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { shortAgo } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { useBoardStore } from '../board/board-store.ts';
import { useSidebarStore } from '../sidebar/sidebar-store.ts';
import { BRAND_LEFT } from '../sidebar/window-controls.tsx';
import { Counters } from './counters.tsx';

/** Counts up each second on its own timer, so the rest of the board keeps the store's slower clock. */
function Refreshed({ fetchedAt }: { fetchedAt: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [fetchedAt]);
  return (
    <p className="refreshed m-0 whitespace-nowrap text-xs text-(--muted-foreground)">
      {fetchedAt ? <>refreshed <time dateTime={fetchedAt}>{shortAgo(fetchedAt, now)}</time></> : 'not read yet'}
    </p>
  );
}

function Scope() {
  const { scope, setScope } = useSidebarStore();
  return (
    <>
      <span className="scope font-medium">{scope ?? 'Whole factory'}</span>
      {scope && (
        <button type="button" aria-label="Show the whole factory" onClick={() => setScope(null)}
          className="grid size-5 place-items-center rounded-sm text-(--muted-foreground) hover:bg-(--accent) [-webkit-app-region:no-drag]">
          <X className="size-3" />
        </button>
      )}
    </>
  );
}

export function TitleBar() {
  const data = useBoardStore((state) => state.data);
  const open = useSidebarStore((state) => state.open);
  return (
    <header className={`title-bar flex h-13 shrink-0 select-none items-center gap-2 border-b border-(--border) pr-3 ${open ? 'pl-4' : BRAND_LEFT} [-webkit-app-region:drag]`}>
      {!data.tools?.t3 && (
        <>
          {/* The sidebar's brand is hidden from screen readers, so the page's heading is here, for them only. */}
          <h1 className="sr-only">µx Factory</h1>
          <Scope />
          <Refreshed fetchedAt={data.fetchedAt} />
          <div className="flex min-w-0 flex-1 items-center justify-center"><Counters /></div>
          <span className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
            <Button variant="outline" size="xs" disabled title="This week isn't built yet">This week</Button>
          </span>
        </>
      )}
    </header>
  );
}
