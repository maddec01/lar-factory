// The work record's own text in the item dialog, ahead of any ticket's: a concept's map, a decision's text or any other
// record's brief, with its build phase, review rounds and the initial context it began with, folded. Export markdown
// writes it to Downloads as `lar-work export` does and names the files it wrote, or says why it couldn't.

import { useState, type ReactNode } from 'react';
import { parseDecisionMethod, type Item, type RecordDetails } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { RichText } from '@lar-factory/ui/rich-text';
import { MarkdownDiagrams } from '../diagrams/markdown-diagrams.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { postAction } from '../items/card-actions.ts';

const TITLE: Record<RecordDetails['bodyKind'], string> = { brief: 'Brief', map: 'Map', decision: 'Decision' };

function Fact({ label, children, ...rest }: { label: string; children: ReactNode } & Record<`data-${string}`, boolean>) {
  return <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm" {...rest}><span className="shrink-0 text-xs text-(--muted-foreground)">{label}</span>{children}</div>;
}

export type Exported = { state: 'idle' | 'exporting' } | { state: 'done'; paths: string[] } | { state: 'failed'; error: string };

export function ExportMarkdown({ itemId, exported, setExported }: { itemId: string; exported: Exported; setExported: (e: Exported) => void }) {
  const run = async () => {
    setExported({ state: 'exporting' });
    const result = await postAction<{ paths: string[] }>('/api/item-export', { itemId });
    setExported(result.error || !result.paths ? { state: 'failed', error: result.error ?? 'The board did not say what it wrote.' } : { state: 'done', paths: result.paths });
  };
  return <Button {...kind('other')} loading={exported.state === 'exporting'} onClick={() => void run()}>Export markdown</Button>;
}

/** The files an export wrote, or why it couldn't; nothing before one runs. */
export function ExportedLine({ exported }: { exported: Exported }) {
  if (exported.state === 'done') return <p className="m-0 text-xs wrap-anywhere text-(--muted-foreground)" role="status">Exported to {exported.paths.join(', ')}</p>;
  if (exported.state === 'failed') return <p className="m-0 text-xs text-(--error-foreground)" role="alert">{exported.error}</p>;
  return null;
}

export function RecordText({ item, record, className, spec = false }: { spec?: boolean; item: Item; record: RecordDetails; className: string }) {
  const [exported, setExported] = useState<Exported>({ state: 'idle' });
  const answer = record.bodyKind === 'decision' ? record.answer?.trim() : undefined;
  const body = record.bodyKind === 'decision' && record.body && parseDecisionMethod(record.body)
    ? record.body.split('\n').slice(1).join('\n').trimStart() : record.body;
  const title = spec ? 'Work record' : answer ? 'Outcome' : TITLE[record.bodyKind];
  return (
    <section className={`grid min-w-0 gap-2 ${className}`} data-record>
      <div className="flex h-7 items-center justify-between gap-2">
        <h2 className="m-0 text-[11px] font-medium uppercase tracking-wider text-(--muted-foreground)">{title}</h2>
        <ExportMarkdown itemId={item.id} exported={exported} setExported={setExported} />
      </div>
      <ExportedLine exported={exported} />
      {!spec && <div data-record-body>
        {answer ? <MarkdownDiagrams text={answer} /> : body ? <MarkdownDiagrams text={body} /> : <p className="m-0 text-sm text-(--muted-foreground)">No {title.toLowerCase()} written yet.</p>}
      </div>}
      {!spec && answer && body && <details>
        <summary className="cursor-pointer text-sm text-(--muted-foreground)">Original question</summary>
        <div className="pt-2"><MarkdownDiagrams text={body} /></div>
      </details>}
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
      {!spec && record.context && (
        <details className="grid min-w-0 gap-2">
          <summary className="cursor-pointer text-sm text-(--muted-foreground)">Initial context</summary>
          <RichText className="pt-2" text={record.context} format="markdown" />
        </details>
      )}
    </section>
  );
}
