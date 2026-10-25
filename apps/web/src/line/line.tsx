// The line: the work moving through the factory, as the Queue, the dossiers, and everything else in flight. Each part
// takes the items in the main area's scope.

import type { Item } from '@lar-factory/shared';
import { Dossiers } from './dossiers.tsx';
import { InFlight } from './in-flight.tsx';
import { Queue } from './queue.tsx';

export function Line({ items }: { items: Item[] }) {
  return (
    <section className="line grid gap-3" aria-labelledby="line-h">
      <h2 id="line-h" className="m-0 text-[13px] font-medium">The line</h2>
      <div className="@container grid gap-4">
        <Queue items={items} />
        <Dossiers items={items} />
        <InFlight items={items} />
      </div>
    </section>
  );
}
