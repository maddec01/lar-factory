// The item dialog's progress at the top of its panel: active steps as a bar, the past slim, the upcoming faint, and the
// current one widest, named, with its step number. While a build is In progress or in Review its segment divides into
// one mini segment per slice; at any other status the slices get a small bar of their own. A chip for each slice
// follows, so what the bar shows is also readable.

import { itemName } from '@lar-factory/shared';
import type { Item, Slice, Status } from '@lar-factory/shared';
import { ActivityFeedback, useActivityFeedback, SliceBar, SliceMark } from '../items/item-parts.tsx';
import { STATUS_COLOR } from '../items/status-glyph.tsx';
import { WORKFLOW_STEPS } from '../items/workflow-steps.ts';
import { SourceIcon } from '../items/source-icon.tsx';

const SPLIT_STATUSES: readonly Status[] = ['In progress', 'Review'];

function SliceChip({ slice }: { slice: Slice }) {
  return (
    <li title={`${itemName(slice)} (${slice.progress})`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--border) bg-(--card) py-0.5 ps-1 pe-2.5 text-xs">
      <SourceIcon item={slice} />
      <SliceMark progress={slice.progress} />
      {slice.number > 0 && <span className="shrink-0 text-(--muted-foreground) tabular-nums">#{slice.number}</span>}
      <span className={`min-w-0 truncate ${slice.progress === 'done' ? 'text-(--muted-foreground)' : slice.progress === 'active' ? 'font-medium' : ''}`}>{slice.title}</span>
      <span className="shrink-0 text-[11px] text-(--muted-foreground)">{slice.progress}</span>
    </li>
  );
}

export function ItemProgress({ item }: { item: Item }) {
  const feedback = useActivityFeedback(item);
  const at = WORKFLOW_STEPS.indexOf(item.status);
  const split = item.slices.length > 0 && SPLIT_STATUSES.includes(item.status);
  const done = item.slices.filter((s) => s.progress === 'done').length;
  if (at < 0 && !item.slices.length) return null;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-progress>
      {at >= 0 && <ol className="m-0 flex list-none items-end gap-[3px] p-0" data-steps>
        {WORKFLOW_STEPS.map((s, i) => {
          const label = `Step ${i + 1} of ${WORKFLOW_STEPS.length}: ${s}`;
          if (i !== at) {
            return <li key={s} title={s} aria-label={label} className="h-1.5 min-w-1.5 flex-1 rounded-full"
              style={{ background: i < at ? 'color-mix(in srgb, var(--foreground) 28%, transparent)' : 'var(--soft)' }} />;
          }
          return (
            <li key={s} title={s} aria-label={label} aria-current="step" className="grid min-w-26 flex-[6] gap-1">
              <span className="flex items-baseline justify-between gap-2 text-xs leading-4">
                <span className="truncate font-medium">{s}</span>
                <span className="shrink-0 text-(--muted-foreground) tabular-nums">{i + 1}/{WORKFLOW_STEPS.length}</span>
              </span>
              {split
                ? <div aria-hidden><SliceBar item={item} thick /></div>
                : <span className="h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${STATUS_COLOR[s]} 55%, transparent), ${STATUS_COLOR[s]})` }} />}
            </li>
          );
        })}
      </ol>}
      {!item.slices.length && <div className="grid gap-1"><ActivityFeedback feedback={feedback} /><ActivityFeedback feedback={feedback} labelOnly /></div>}
      {item.slices.length > 0 && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-slices>
          <p className="m-0 text-xs text-(--muted-foreground)"><span className="font-medium text-(--foreground)">Slices</span> · {done}/{item.slices.length} done</p>
          {!split && <div aria-hidden><SliceBar item={item} thick /></div>}
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {item.slices.map((s) => <SliceChip key={s.workId ?? s.number} slice={s} />)}
          </ul>
        </div>
      )}
    </div>
  );
}
