// PROTOTYPE, throwaway. Line variant "current": the board style, one column per station from Queued to Ready to
// merge, cards stacked under each. Kept to compare against.

import { ArrowRight } from 'lucide-react';
import { platformOf } from '@mux-factory/shared';
import type { Status } from '@mux-factory/shared';
import { STATUS_COLOR, StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, SliceBar, refText } from '../item-bits.tsx';
import type { LineProps } from './line-data.ts';

export const NAME = 'Board (current)';
const STATIONS: Status[] = ['Queued', 'Shaping', 'Ready', 'In progress', 'Review', 'Verify', 'Ready to merge'];
const picked = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : '');

export function LineCurrent({ items, data, pick }: LineProps) {
  return (
    <div className="flex items-stretch overflow-x-auto rounded-xl border border-(--border) bg-(--card)">
      {STATIONS.map((st, n) => {
        const here = items.filter((i) => i.status === st);
        return (
          <div key={st} className="relative flex min-w-[140px] flex-1 flex-col gap-2 border-r border-(--border) p-3 last:border-r-0">
            <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium"><StatusGlyph status={st} />{st}<span className="text-(--muted-foreground)">{here.length}</span></div>
            <div className="h-0.5 rounded-full" style={{ background: STATUS_COLOR[st], opacity: here.length ? 1 : 0.25 }} />
            {here.map((i) => (
              <button key={i.id} type="button" onClick={() => pick.set(i.id)} title={`${refText(i)} ${i.title}`}
                className={`grid gap-1 rounded-md bg-(--muted) px-2 py-1.5 text-left hover:bg-(--accent) ${picked(pick.id === i.id)}`}>
                <span className="line-clamp-2 text-xs leading-snug"><span className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: platformColor(platformOf(i, data.repos)) }} /><ItemTitle item={i} /></span>
                <SliceBar item={i} />
              </button>
            ))}
            {n < STATIONS.length - 1 && <ArrowRight className="absolute -right-2 top-3.5 z-10 size-4 rounded-full bg-(--card) text-(--muted-foreground)" />}
          </div>
        );
      })}
    </div>
  );
}

/** A's item detail in T3's dialog: the same sections, the actions in its footer. Esc or a click outside closes it. */