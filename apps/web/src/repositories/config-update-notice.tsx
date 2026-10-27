// The notice on an onboarded repository's row whose .lar-factory.json is below the app's Repository config version,
// across the row's width under its name and controls.

import type { RepoConfig } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { useConfigUpdateStore } from './config-update-store.ts';

/** Says the file's version and the app's, offers the PR that rewrites the file at the app's, and Dismiss; nothing without a notice. */
export function ConfigUpdateNotice({ repo }: { repo: RepoConfig }) {
  const running = useConfigUpdateStore((state) => state.running[repo.repo]);
  const error = useConfigUpdateStore((state) => state.errors[repo.repo]);
  if (repo.configUpdate === undefined) return null;
  return (
    // A note, not an alert: it shows with the row, so it has nothing to announce.
    <Alert data-config-update tone="info" compact role="note" action={<>
      <span className="flex items-center gap-2">
        <Button disabled={running !== undefined} onClick={() => void useConfigUpdateStore.getState().openPr(repo.repo)}>
          {running === 'pr' ? 'Opening PR…' : 'Open PR'}</Button>
        <Button variant="quiet" disabled={running !== undefined} onClick={() => void useConfigUpdateStore.getState().dismiss(repo.repo)}>Dismiss</Button>
      </span>
      {error && <span role="alert" className="mt-2 block text-(--lar-danger-text)">{error}</span>}
    </>}>
      Its .lar-factory.json is at version {repo.version ?? 1}, and Lar Factory now writes version {repo.configUpdate}. The board reads the
      older file with defaults. The PR rewrites the file with the same values at version {repo.configUpdate}.
    </Alert>
  );
}
