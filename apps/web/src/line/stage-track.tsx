// The line's stages: the six-stage track a dossier's parts show, and what the line says of an item's thread and of an
// item that waits on you.

import { clock } from '@lar-factory/shared';
import type { Item, ItemStats, ItemThread, Status, ThreadState } from '@lar-factory/shared';
import { STATUS_COLOR, StatusGlyph } from '../items/status-glyph.tsx';

const STAGES: { name: string; statuses: Status[] }[] = [
  { name: 'Refining', statuses: ['Shaping', 'Needs you'] },
  { name: 'Ready', statuses: ['Ready'] },
  { name: 'Building', statuses: ['In progress'] },
  { name: 'Review', statuses: ['Review'] },
  { name: 'Verify', statuses: ['Verify', 'Ready to merge'] },
  { name: 'Done', statuses: ['Done'] },
];
/** The status's stage on the track, or -1 for List and Queued, which sit before it. */
export const stageOf = (s: Status) => STAGES.findIndex((st) => st.statuses.includes(s));
export const picked = (on: boolean) => (on ? 'bg-(--accent) ring-2 ring-inset ring-(--primary)' : '');
const PAST = 'color-mix(in srgb, var(--foreground) 28%, transparent)';

/** The desk's statuses the line takes no action on. Ready is on the desk too, but keeps Start build on the line. */
export const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];

/** Activity comes from T3, never from the item's workflow status. */
const THREAD_TEXT: Record<ThreadState, string> = {
  running: 'Thread running', 'needs you': 'Thread needs you', stopped: 'Run stopped', done: 'Run finished',
};
export function threadText(item: Item): string {
  if (item.threads === 'unavailable') return 'Thread unavailable';
  const latest = item.threads?.[0];
  return latest ? `${THREAD_TEXT[latest.state]}${lastSeen(latest)}` : 'Not started';
}

/** While T3 can't be read, when the board last saw the thread's state: `, last seen 14:05`; empty otherwise. */
export const lastSeen = (thread: ItemThread): string => (thread.observedAt ? `, last seen ${clock(thread.observedAt, undefined)}` : '');

/** Where to act on an item that waits on you. */
export function OnYourDesk({ status }: { status: Status }) {
  return <span className="inline-flex items-center gap-1 text-(--warning-foreground)"><StatusGlyph status={status} className="size-3" />on your desk</span>;
}

export const statsOf = (item: Item): ItemStats | null => (item.stats && item.stats !== 'unavailable' ? item.stats : null);

/** Six stage cells: the stages behind filled, the current one coloured up to its glyph, the rest faint. */
export function Track({ status, waiting }: { status: Status; waiting?: boolean }) {
  const at = stageOf(status);
  return (
    <ol className="m-0 grid list-none grid-cols-6 gap-px p-0" title={`${status}${waiting ? ', waiting' : ''}`}>
      {STAGES.map((st, n) => (
        <li key={st.name} className="relative flex h-5 items-center justify-center">
          <span className={`absolute inset-x-0 h-1.5 ${n === 0 ? 'rounded-l-full' : ''} ${n === STAGES.length - 1 ? 'rounded-r-full' : ''}`}
            style={{ background: n < at ? PAST : 'var(--soft)' }} />
          {n === at && (
            <>
              <span className={`absolute left-0 right-1/2 h-1.5 ${n === 0 ? 'rounded-l-full' : ''}`} style={{ background: STATUS_COLOR[status], opacity: waiting ? 0.35 : 1 }} />
              <span className={`relative grid size-5 place-items-center rounded-full bg-(--card) ${waiting ? 'border border-dashed border-(--muted-foreground)' : ''}`}><StatusGlyph status={status} /></span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
