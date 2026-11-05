// One glyph per status, the way T3 marks a thread working, waiting or done, in the status's colour.

import { Check, Circle, CircleArrowRight, CircleDashed, CircleDot, Clock3, Eye, GitMerge, List } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { activityLost, activityUnavailable, buildActivity, itemActivityLine, itemActivityThread } from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useClock } from '../board/second-clock.ts';
import { Spinner } from '../loading/loader.tsx';
import { ambientMotion } from '../motion/ambient-motion.ts';
import { useStartStore } from './start-store.ts';

export const STATUS_COLOR: Record<Status, string> = {
  List: 'var(--st-idle)', Queued: 'var(--st-idle)', Shaping: 'var(--st-now)', 'Needs you': 'var(--st-amber)', Ready: 'var(--st-now)',
  'In progress': 'var(--st-now)', Review: 'var(--st-review)', Verify: 'var(--st-amber)', 'Ready to merge': 'var(--st-done)', Done: 'var(--st-done)',
};

export function StatusGlyph({ status, running = false, className = 'size-3.5' }: { status: Status; running?: boolean; className?: string }) {
  const style = { color: STATUS_COLOR[status] };
  const pulse = running && ['Shaping', 'Review', 'Verify', 'Ready to merge'].includes(status);
  const props = { ref: pulse ? ambientMotion : undefined, className: `shrink-0 ${className}${pulse ? ' status-pulse' : ''}`, style, strokeWidth: 2.25 };
  switch (status) {
    case 'List': return <List {...props} />;
    case 'Needs you': case 'Verify': return <CircleDot {...props} />;
    case 'In progress': return running ? <Spinner spin="status-spin" {...props} /> : <Circle {...props} />;
    case 'Ready': return <CircleArrowRight {...props} />;
    case 'Shaping': return <CircleDashed {...props} />;
    case 'Review': return <Eye {...props} />;
    case 'Ready to merge': return <GitMerge {...props} />;
    case 'Done': return <Check {...props} />;
    case 'Queued': return <Clock3 {...props} />;
    default: return <Circle {...props} />;
  }
}

/** Current execution for status icons, including delegated work after its parent turn ends. */
export function useStatusActivity() {
  const unavailable = useBoardStore(({ data, now, clientError }) => activityUnavailable(data, now, clientError) || !!data.localProblem
    || !!data.tools?.t3 && data.tools.t3.result !== 'ok'
    || !!data.t3Availability && (data.t3Availability.availability !== 'available' || !!data.t3Availability.observedAt));
  // A push makes a new startProgress each time, so this selects the ids of the items with a start in flight.
  const starting = useBoardStore(useShallow((state) => Object.entries(state.data.startProgress ?? {})
    .filter(([, starts]) => Object.values(starts).some((start) => start.phase === 'starting' || start.phase === 'may-have-started'))
    .map(([id]) => id)));
  const starts = useStartStore((state) => state.starts);
  const builds = useStartStore((state) => state.builds);
  return (item: Item): boolean => {
    if (unavailable || item.paused || item.archived || item.needsYou || item.threads === 'unavailable') return false;
    // A thread waiting on the user, stopped, or whose activity T3 couldn't give isn't known to be moving.
    const now = Date.now();
    const line = itemActivityLine(item, now)?.state;
    if (line === 'waiting' || line === 'stopped' || activityLost(itemActivityThread(item)?.activity, now)) return false;
    if (starts[item.id]?.phase === 'pending' || builds[item.id]?.phase === 'pending' || starting.includes(item.id)) return false;
    if (item.status === 'Shaping') {
      return !!item.threads?.some(thread => thread.purpose !== 'build' && !thread.observedAt && !thread.archived
        && (thread.currentRunning || thread.hasRunningChildren));
    }
    return ['In progress', 'Review', 'Verify', 'Ready to merge'].includes(item.status) && buildActivity(item).running;
  };
}

/** The item's recorded status, animated only while its execution is trusted. */
export function ItemStatusGlyph({ item, status = item.status, className }: { item: Item; status?: Status; className?: string }) {
  const running = useStatusActivity();
  // A read going old changes the answer with no new data.
  useClock((now) => activityLost(itemActivityThread(item)?.activity, now));
  return <StatusGlyph status={status} running={running(item)} className={className} />;
}
