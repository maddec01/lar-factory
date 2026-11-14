// Start build on a Ready item, on the line and in the item dialog: today's Start with its model menu, posting to
// /api/start-build. Open thread takes its place while the item has a running, queued or needs-you thread, and Start after
// while an issue it's blocked by is open. It's disabled, its title saying why, while its repository is still
// onboarding or T3 has no project for its repository.

import { startActionChoice, buildAccessProblem, sameRepo, type BoardData, type Item } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';

import { ICON } from './ButtonIcons';
import { HumanWaitAction } from './HumanWaitAction';
import { hasLiveThread } from './ItemThreads';
import { OpenThread } from './OpenThread';
import { useOnRow } from './RowContext';
import { StartOrAfter } from './StartAfter';
import { useButtonKind } from '@/ui/board';

/** The shared action choice names the build on every surface. */
export function StartBuild({
    item,
    data,
    linkedBeside,
}: {
    item: Item;
    data: BoardData;
    linkedBeside?: string | undefined;
}) {
    const kindOf = useButtonKind();
    const short = useOnRow();
    const onRow = short;
    const { label } = startActionChoice(item, 'build');

    if (item.briefApproval) return <HumanWaitAction item={item} data={data} />;

    // A thread already at work on the item would get a second one.
    if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;

    const setup = data.repos.find((repo) => sameRepo(repo.repo, item.repo))?.setup;
    const problem = setup && buildAccessProblem(setup.access);

    if (problem)
        return (
            <Button
                {...kindOf(onRow ? 'start' : 'main')}
                leftIcon={ICON.play}
                disabled
                title={problem}
                data-build-unavailable={item.id}
            >
                {label}
            </Button>
        );

    return <StartOrAfter item={item} data={data} kind="build" linkedBeside={linkedBeside} />;
}
