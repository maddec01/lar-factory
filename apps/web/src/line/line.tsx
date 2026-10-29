// The line: the work moving through the factory, as the Queue, the dossiers, and everything else in flight. Each part
// takes the items in the main area's scope.

import { useState } from 'react';
import type { Item } from '@lar-factory/shared';
import { Dossiers } from './dossiers.tsx';
import { InFlight } from './in-flight.tsx';
import { PrototypeDossiers, PrototypeInFlight, PrototypeSwitcher, variantOf } from './line-prototype.tsx';
import { Queue } from './queue.tsx';

export function Line({ items }: { items: Item[] }) {
  // PROTOTYPE #472: `?variant=a1|a2|a|b|c|current` swaps the dossiers and in-flight rows; a1 by default.
  const [variant, setVariant] = useState(variantOf);
  return (
    <section className="line grid gap-3" aria-labelledby="line-h">
      <h2 id="line-h" className="m-0 text-[13px] font-medium">The line</h2>
      <div className="@container grid gap-4">
        <Queue items={items} />
        {variant === 'current' ? <Dossiers items={items} /> : <PrototypeDossiers items={items} variant={variant} />}
        {variant === 'current' ? <InFlight items={items} /> : <PrototypeInFlight items={items} variant={variant} />}
      </div>
      <PrototypeSwitcher variant={variant} onVariant={setVariant} />
    </section>
  );
}
