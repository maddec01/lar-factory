// The warning for Drift in the board app's installed skills, in the shared notification stack: it names the skills
// that changed since Lar Factory installed them, and Replace puts the app's Release back.

import { useEffect } from 'react';
import { listed } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { Warning } from './warning.tsx';
import { useDriftStore } from './drift-store.ts';
import { DRIFT } from './dismiss-store.ts';

export function DriftWarning() {
  const { skills, replacing, error, follow, replace } = useDriftStore();
  useEffect(follow, [follow]);
  if (skills.length === 0) return null;
  const them = skills.length > 1 ? 'them' : 'it';
  return (
    <Warning dismissKey={DRIFT} title="Some of lar's skills changed."
      action={<Button {...kind('other')} data-replace-drift disabled={replacing} onClick={() => void replace()}>{replacing ? 'Replacing…' : 'Replace'}</Button>}>
      {listed(skills)} changed since Lar Factory installed {them}. Replace puts this Release's copy back; Start build asks again.
      {error && <> <span role="alert">Couldn't replace {them}: {error}</span></>}
    </Warning>
  );
}
