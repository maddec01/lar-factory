// The work record's own text in the item dialog, ahead of any ticket's: a concept's map, a decision's text or any other
// record's brief, with its build phase, review rounds and the initial context it began with, folded. Export markdown
// writes it to Downloads as `lar-work export` does and names the files it wrote, or says why it couldn't.

import { useState, type ReactNode } from 'react';
import type { Item, RecordDetails } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RichText } from '@lar-factory/ui/rich-text';
import { kind } from '../buttons/button-kinds.tsx';
import { postAction } from '../items/card-actions.ts';

const TITLE: Record<RecordDetails['bodyKind'], string> = { brief: 'Brief', map: 'Map', decision: 'Decision' };

function Fact({ label, children, ...rest }: { label: string; children: ReactNode } & Record<`data-${string}`, boolean>) {
  return <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm" {...rest}><span className="shrink-0 text-xs text-(--muted-foreground)">{label}</span>{children}</div>;
}

type Exported = { state: 'idle' | 'exporting' } | { state: 'done'; paths: string[] } | { state: 'failed'; error: string };

function ExportMarkdown({ itemId, exported, setExported }: { itemId: string; exported: Exported; setExported: (e: Exported) => void }) {
  const run = async () => {
    setExported({ state: 'exporting' });
    const result = await postAction<{ paths: string[] }>('/api/item-export', { itemId });
    setExported(result.error || !result.paths ? { state: 'failed', error: result.error ?? 'The board did not say what it wrote.' } : { state: 'done', paths: result.paths });
  };
  return <Button {...kind('other')} loading={exported.state === 'exporting'} onClick={() => void run()}>Export markdown</Button>;
}

export function RecordText({ item, record, className }: { item: Item; record: RecordDetails; className: string }) {
  const [exported, setExported] = useState<Exported>({ state: 'idle' });
  const title = TITLE[record.bodyKind];
  return (
    <section className={`grid min-w-0 gap-2 ${className}`} data-record>
      <div className="flex h-7 items-center justify-between gap-2">
        <h2 className="m-0 text-[11px] font-medium uppercase tracking-wider text-(--muted-foreground)">{title}</h2>
        <ExportMarkdown itemId={item.id} exported={exported} setExported={setExported} />
      </div>
      {exported.state === 'done' && <p className="m-0 text-xs wrap-anywhere text-(--muted-foreground)" role="status">Exported to {exported.paths.join(', ')}</p>}
      {exported.state === 'failed' && <p className="m-0 text-xs text-(--error-foreground)" role="alert">{exported.error}</p>}
      <div data-record-body>
        {record.body ? <RichText text={record.body} format="markdown" /> : <p className="m-0 text-sm text-(--muted-foreground)">No {title.toLowerCase()} written yet.</p>}
      </div>
      {record.buildPhase && <Fact label="Build phase" data-build-phase>{record.buildPhase}</Fact>}
      {record.reviewRounds.length > 0 && (
        <div className="grid gap-1" data-review-rounds>
          {record.reviewRounds.map((r) => (
            <Fact key={r.round} label={`Review round ${r.round}`}>
              <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0">
                {r.reviewers.map((v) => <li key={v.axis}>{v.axis}: {v.verdict}{v.open > 0 && `, ${v.open} of ${v.findings} findings open`}</li>)}
              </ul>
            </Fact>
          ))}
        </div>
      )}
      {record.context && (
        <details className="grid min-w-0 gap-2">
          <summary className="cursor-pointer text-sm text-(--muted-foreground)">Initial context</summary>
          <RichText className="pt-2" text={record.context} format="markdown" />
        </details>
      )}
    </section>
  );
}
