// A section of the board's work by stage: a titled list that takes the height of its rows, so a section with none stays
// small and the page scrolls past them all.

import type { ReactNode } from 'react';
import type { Status } from '@lar-factory/shared';
import { StatusGlyph } from '../items/status-glyph.tsx';

export function Pane({ id, title, status, count, right, className = '', children }: {
  id: string; title: string; status?: Status; count: number; right?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section data-stage={id} aria-labelledby={`${id}-h`} className={`min-w-0 overflow-hidden rounded-xl border border-(--border) bg-(--card) shadow-xs ${className}`}>
      <header className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--border) px-3 py-1">
        {status && <StatusGlyph status={status} />}
        <h3 id={`${id}-h`} className="m-0 whitespace-nowrap text-[13px] font-medium">{title} <span className="font-normal tabular-nums text-(--muted-foreground)">{count}</span></h3>
        {right && <span className="ml-auto flex min-w-0 max-w-full items-center">{right}</span>}
      </header>
      <div className="@container">{children}</div>
    </section>
  );
}

/** What a section says with no row: `filtered` while a filter hides every row it has. */
export function PaneEmpty({ filtered, none, children }: { filtered: boolean; none: string; children: string }) {
  return <p className="m-0 px-3 py-1.5 text-[12px] text-(--muted-foreground)">{filtered ? children : none}</p>;
}
