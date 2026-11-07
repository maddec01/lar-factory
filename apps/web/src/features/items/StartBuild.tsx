// Start build on a Ready item, on the line and in the item dialog: today's Start with its model menu, posting to
// /api/start-build. Open thread takes its place while the item has a running, queued or needs-you thread, and Start after
// while an issue it's blocked by is open. It's disabled, its title saying why, while its repository is still
// onboarding or T3 has no project for its repository.

import { buildAccessProblem, sameRepo, type BoardData, type Item } from '@lar-factory/shared';
import { Button, buttonKind } from '@lar-works/design-system';

import { ICON } from './ButtonIcons';
import { OpenThread, hasLiveThread } from './OpenThread';
import { useOnRow } from './RowActions';
import { StartOrAfter } from './StartAfter';

/** A dossier names it `label`; a row calls it Start. */
export function StartBuild({
    item,
    data,
    label: given,
    linkedBeside,
    namesBlocker,
}: {
    item: Item;
    data: BoardData;
    label?: string;
    linkedBeside?: string | undefined;
    namesBlocker?: boolean;
}) {
    const short = useOnRow();
    const label = given ?? (short ? 'Start' : 'Start build');

    // A thread already at work on the item would get a second one.
    if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;

    const setup = data.repos.find((repo) => sameRepo(repo.repo, item.repo))?.setup;
    const problem = setup && buildAccessProblem(setup.access);

    if (problem)
        return (
            <Button
                {...buttonKind('start')}
                leftIcon={ICON.play}
                disabled
                title={problem}
                data-build-unavailable={item.id}
            >
                {label}
            </Button>
        );

    return (
        <StartOrAfter
            item={item}
            data={data}
            label={label}
            kind="build"
            linkedBeside={linkedBeside}
            {...(namesBlocker === undefined ? {} : { namesBlocker })}
        />
    );
}
