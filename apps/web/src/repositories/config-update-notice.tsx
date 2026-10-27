// The notice on an onboarded repository's row whose .lar-factory.json is below the app's Repository config version,
// across the row's width under its name and controls.

import type { RepoConfig } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';
import { useConfigUpdateStore } from './config-update-store.ts';

/** Says the file's version and the app's, offers the PR that rewrites the file at the app's, and Dismiss; nothing without a notice. */
export function ConfigUpdateNotice({ repo }: { repo: RepoConfig }) {
  const running = useConfigUpdateStore((state) => state.running[repo.repo]);
  const error = useConfigUpdateStore((state) => state.errors[repo.repo]);
  if (repo.configUpdate === undefined) return null;
  return <div data-config-update className="grid gap-2 rounded-lg border border-border bg-muted p-2 text-xs text-foreground">
    <span>Its .lar-factory.json is at version {repo.version ?? 1}, and Lar Factory now writes version {repo.configUpdate}. The board reads the
      older file with defaults. The PR rewrites the file with the same values at version {repo.configUpdate}.</span>
    <span className="flex items-center gap-2">
      <Button size="xs" disabled={running !== undefined} onClick={() => void useConfigUpdateStore.getState().openPr(repo.repo)}>
        {running === 'pr' ? 'Opening PR…' : 'Open PR'}</Button>
      <Button variant="ghost" size="xs" disabled={running !== undefined} onClick={() => void useConfigUpdateStore.getState().dismiss(repo.repo)}>Dismiss</Button>
    </span>
    {error && <span role="alert" className="text-destructive-foreground">{error}</span>}
  </div>;
}
