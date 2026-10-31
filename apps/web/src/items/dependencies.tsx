// The Dependencies holding a build, in the item dialog: each one's owning team or repository, its need, ticket, latest
// read and evidence, what the board asks about it, and Mark met or Clear met mark. Only the user's mark releases the
// build; a read never does.

import { dependencyNotice, itemName, shortAgo } from '@lar-factory/shared';
import type { BoardData, DependencyHold, Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useItemAction } from './action-store.ts';
import { markDependencyMet } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { kind } from '../buttons/button-kinds.tsx';

/** The Dependencies holding the item, met or not. */
export const dependenciesOf = (item: Item): DependencyHold[] => item.blockers.flatMap((b) => (b.dependency ? [b.dependency] : []));

/** What the latest read of its ticket or a PR showed, and when; or that nothing was read. */
const readText = (d: DependencyHold, now: number): string => d.observation
  ? `${d.observation.subject} ${d.observation.kind}, read ${shortAgo(d.observation.observedAt, now)}`
  : `${d.ticket ?? 'Its ticket'} not read yet`;

export function Dependencies({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const action = useItemAction(item.id);
  const state = writeState(data, action);
  return (
    <ul className="m-0 grid list-none gap-3 p-0 text-sm">
      {dependenciesOf(item).map((d) => {
        const notice = dependencyNotice(d);
        return (
          <li key={d.dependencyId} className="grid gap-1" data-dependency={d.dependencyId}>
            <span className="font-medium" data-dependency-owner>
              Dependency on {d.owner} · {d.met ? `met, marked by ${d.met.by} ${shortAgo(d.met.at, now)}` : 'not met'}
            </span>
            <span>{d.need}</span>
            <span className="text-xs text-(--muted-foreground)" data-dependency-read>{readText(d, now)}</span>
            <span className="text-xs text-(--muted-foreground)" data-dependency-evidence>{d.evidence ? `Evidence: ${d.evidence}` : 'No evidence agreed yet'}</span>
            {notice && <p className="m-0 text-xs font-medium text-(--warning-foreground)" data-dependency-notice>{notice}</p>}
            <span>
              <Button {...kind('other')} {...state} data-dependency-met={item.id}
                aria-label={`${d.met ? `Clear the met mark on the Dependency on ${d.owner}` : `Mark the Dependency on ${d.owner} met`}: ${itemName(item)}`}
                onClick={() => void markDependencyMet(item.id, d.dependencyId, d.revision, !d.met)}>{d.met ? 'Clear met mark' : 'Mark met'}</Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
