// Start build on a Ready item, on the line and in the item dialog: today's Start with its model menu, posting to
// /api/start-build. Open thread takes its place while the item has a running or needs-you thread, and Start after
// while an issue it's blocked by is open. It's disabled, its title saying why, while its repository is still
// onboarding or T3 has no project for its repository.

import { buildAccessProblem, sameRepo, type BoardData, type Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { ICON, kind } from '../buttons/button-kinds.tsx';
import { OpenThread, hasLiveThread } from './open-thread.tsx';
import { StartOrAfter } from './start-after.tsx';

/** A dossier names it `label`. */
export function StartBuild({ item, data, label = 'Start build' }: { item: Item; data: BoardData; label?: string }) {
  // A thread already at work on the item would get a second one.
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;
  const setup = data.repos.find(repo => sameRepo(repo.repo, item.repo))?.setup;
  const problem = setup && buildAccessProblem(setup.access);
  if (problem) return <Button {...kind('start')} leftIcon={ICON.play} disabled title={problem} data-build-unavailable={item.id}>{label}</Button>;
  return <StartOrAfter item={item} data={data} label={label} kind="build" />;
}
