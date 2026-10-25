// One glyph per status, the way T3 marks a thread working, waiting or done, in the status's colour.

import { Check, Circle, CircleDashed, CircleDot, Clock3, Eye, GitMerge, LoaderCircle } from 'lucide-react';
import type { Status } from '@lar-factory/shared';

export const STATUS_COLOR: Record<Status, string> = {
  List: 'var(--st-idle)', Queued: 'var(--st-idle)', Shaping: 'var(--st-now)', 'Needs you': 'var(--st-amber)', Ready: 'var(--st-now)',
  'In progress': 'var(--st-now)', Review: 'var(--st-review)', Verify: 'var(--st-amber)', 'Ready to merge': 'var(--st-done)', Done: 'var(--st-done)',
};

export function StatusGlyph({ status, className = 'size-3.5' }: { status: Status; className?: string }) {
  const style = { color: STATUS_COLOR[status] };
  const props = { className: `shrink-0 ${className}`, style, strokeWidth: 2.25 };
  switch (status) {
    case 'Needs you': case 'Verify': return <CircleDot {...props} className={`${props.className} status-pulse`} />;
    case 'In progress': return <LoaderCircle {...props} className={`${props.className} animate-spin [animation-duration:2.4s]`} />;
    case 'Shaping': return <CircleDashed {...props} />;
    case 'Review': return <Eye {...props} />;
    case 'Ready to merge': return <GitMerge {...props} />;
    case 'Done': return <Check {...props} />;
    case 'Queued': return <Clock3 {...props} />;
    default: return <Circle {...props} />;
  }
}
