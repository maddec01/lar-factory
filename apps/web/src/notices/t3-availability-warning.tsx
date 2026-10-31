import { useState } from 'react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { Warning } from './warning.tsx';

const titles = {
  unavailable: 'T3 Code is disconnected.',
  'renewal-required': 'T3 authorization needs renewal.',
  'unsupported-version': 'This T3 Code version is unsupported.',
  malformed: 'T3 Code returned an unreadable observation.',
};

export function T3AvailabilityWarning() {
  const source = useBoardStore(state => state.data.t3Availability);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!source || source.availability === 'available') return null;
  const renew = async () => {
    if (pending) return;
    setPending(true);
    const result = await postAction('/api/t3/reauthorize', {});
    setError(result.error);
    setPending(false);
    receive(result);
  };
  return <Warning dismissKey={`t3-source:${source.availability}`} title={titles[source.availability]}>
    {source.observedAt
      ? <>Showing retained T3 data. Last successful observation: <time dateTime={source.observedAt}>{source.observedAt}</time>. </>
      : <>No successful T3 observation yet. </>}
    {source.availability === 'unsupported-version'
      ? 'Use a supported T3 Code version.'
      : source.availability === 'renewal-required'
        ? <Button {...kind('other')} disabled={pending} onClick={() => void renew()}>{pending ? 'Reauthorizing…' : 'Reauthorize T3'}</Button>
        : 'The board retries while T3 Code is running.'}
    {error && <span role="alert"> {error}</span>}
  </Warning>;
}
