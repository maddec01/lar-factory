// The board app's warnings about installing lar's skills, in the shared notification stack beside Drift's: a Clash,
// a folder Lar Factory didn't install that holds a skill's name, and an install that failed. Each names where, and
// Retry has the app check again.

import { useEffect } from 'react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { Warning } from './warning.tsx';
import { useDriftStore } from './drift-store.ts';
import { SKILL_CLASH, SKILL_INSTALL_FAILED } from './dismiss-store.ts';

/** The folder holding `path`. */
const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

function RetryInstall() {
  const { retrying, retryError, retry } = useDriftStore();
  return (
    <>
      <Button {...kind('other')} data-retry-install disabled={retrying} onClick={() => void retry()}>{retrying ? 'Retrying…' : 'Retry'}</Button>
      {retryError && <span role="alert" className="ml-2">Couldn't retry: {retryError}</span>}
    </>
  );
}

export function ClashWarning() {
  const { blocked, follow } = useDriftStore();
  useEffect(follow, [follow]);
  const paths = blocked.flatMap(({ skill, paths }) => paths.map(({ path }) => ({ skill, path })));
  if (paths.length === 0) return null;
  return (
    <Warning dismissKey={SKILL_CLASH} title={paths.length > 1 ? "Folders block some of lar's skills." : "A folder blocks one of lar's skills."}
      action={<RetryInstall />}>
      {paths.map(({ skill, path }) => `${skill} in ${folderOf(path)} isn't Lar Factory's, so it left it alone. `).join('')}
      Rename or remove {paths.length > 1 ? 'each' : 'it'}, then Retry. Start build stays refused until then.
    </Warning>
  );
}

export function InstallFailedWarning() {
  const { failures, follow } = useDriftStore();
  useEffect(follow, [follow]);
  if (failures.length === 0) return null;
  return (
    <Warning dismissKey={SKILL_INSTALL_FAILED} title="Lar Factory couldn't install its skills." action={<RetryInstall />}>
      {failures.map(({ path, reason }) => `${path ? `${path}: ` : ''}${reason.replace(/\.$/, '')}. `).join('')}
      Retry tries again; Start build stays refused until it works.
    </Warning>
  );
}
