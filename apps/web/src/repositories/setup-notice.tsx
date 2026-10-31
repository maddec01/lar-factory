// The notice on an onboarded repository's row while its item source or domain-doc location changed since the user last
// accepted its setup, across the row's width: what changed, the work waiting on it, and Accept, which lets that work go on.

import { sameRepo, type RepoConfig } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { useBoardStore } from '../board/board-store.ts';
import { useEditStore } from './edit-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

const CHANGED = { itemSource: 'item source', domainDocs: 'domain-doc location' } as const;

export function SetupNotice({ repo }: { repo: RepoConfig }) {
  const items = useBoardStore((s) => s.data.items);
  const running = useEditStore((s) => s.running);
  const error = useEditStore((s) => s.errors[repo.repo]);
  const paused = repo.setup?.paused ?? [];
  if (!paused.length) return null;
  const waiting = items.filter((item) => item.paused && sameRepo(item.repo, repo.repo));
  return (
    // A note, not an alert: it shows with the row, so it has nothing to announce.
    <Alert data-setup-paused tone="warning" compact role="note" action={<>
      <Button {...kind('main')} disabled={running !== null} loading={running === 'accept'} onClick={() => void useEditStore.getState().accept(repo.repo)}>Accept</Button>
      {error && <span role="alert" className="mt-2 block text-(--lar-danger-text)">{error}</span>}
    </>}>
      Its {paused.map((p) => CHANGED[p]).join(' and ')} changed. {waiting.length
        ? `This work waits until you accept the change: ${waiting.map((item) => item.title).join(', ')}.`
        : 'No work waits on it.'}
    </Alert>
  );
}
