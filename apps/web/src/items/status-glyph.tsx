// One glyph per status, the way T3 marks a thread working, waiting or done, in the status's colour.

import { Check, Circle, CircleArrowRight, CircleDashed, CircleDot, Clock3, Eye, GitMerge, List } from 'lucide-react';
import { activityUnavailable, buildActivity } from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { Spinner } from '../loading/loader.tsx';
import { useStartStore } from './start-store.ts';

export const STATUS_COLOR: Record<Status, string> = {
  List: 'var(--st-idle)', Queued: 'var(--st-idle)', Shaping: 'var(--st-now)', 'Needs you': 'var(--st-amber)', Ready: 'var(--st-now)',
  'In progress': 'var(--st-now)', Review: 'var(--st-review)', Verify: 'var(--st-amber)', 'Ready to merge': 'var(--st-done)', Done: 'var(--st-done)',
};

export function StatusGlyph({ status, running = false, className = 'size-3.5' }: { status: Status; running?: boolean; className?: string }) {
  const style = { color: STATUS_COLOR[status] };
  const pulse = running && ['Shaping', 'Review', 'Verify', 'Ready to merge'].includes(status);
  const props = { className: `shrink-0 ${className}${pulse ? ' status-pulse' : ''}`, style, strokeWidth: 2.25 };
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
  const { data, now, clientError } = useBoardStore();
  const { starts, builds } = useStartStore();
  const unavailable = activityUnavailable(data, now, clientError) || !!data.localProblem
    || !!data.tools?.t3 && data.tools.t3.result !== 'ok'
    || !!data.t3Availability && (data.t3Availability.availability !== 'available' || !!data.t3Availability.observedAt);
  return (item: Item): boolean => {
    if (unavailable || item.paused || item.archived || item.needsYou || item.threads === 'unavailable') return false;
    if (starts[item.id]?.phase === 'pending' || builds[item.id]?.phase === 'pending'
      || Object.values(data.startProgress?.[item.id] ?? {}).some(start => start.phase === 'starting' || start.phase === 'may-have-started')) return false;
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
  return <StatusGlyph status={status} running={running(item)} className={className} />;
}
