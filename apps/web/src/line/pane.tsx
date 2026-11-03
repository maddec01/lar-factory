// A section of the board's stage layout: a titled card whose rows scroll inside it, so the page itself never scrolls.
// `footer` stays in view under the rows.

import type { ReactNode } from 'react';
import type { Status } from '@lar-factory/shared';
import { StatusGlyph } from '../items/status-glyph.tsx';

export function Pane({ id, title, status, count, right, footer, className = '', children }: {
  id: string; title: string; status?: Status; count: number; right?: ReactNode; footer?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section data-stage={id} aria-labelledby={`${id}-h`} className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-(--border) bg-(--card) shadow-xs ${className}`}>
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--border) px-3 py-1.5">
        {status && <StatusGlyph status={status} />}
        <h3 id={`${id}-h`} className="m-0 whitespace-nowrap text-[13px] font-medium">{title} <span className="font-normal tabular-nums text-(--muted-foreground)">{count}</span></h3>
        {right && <span className="ml-auto flex min-w-0 max-w-full items-center">{right}</span>}
      </header>
      <div data-scroll className="@container min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </section>
  );
}

/** What a section says with no row: `filtered` while a filter hides every row it has. */
export function PaneEmpty({ filtered, none, children }: { filtered: boolean; none: string; children: string }) {
  return <p className="m-0 px-3 py-4 text-center text-[12px] text-(--muted-foreground)">{filtered ? children : none}</p>;
}
