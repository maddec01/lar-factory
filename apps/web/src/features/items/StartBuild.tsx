// Start build on a Ready item, on the line and in the item dialog: today's Start with its model menu, posting to
// /api/start-build. Open thread takes its place while the item has a running, queued or needs-you thread, and Start after
// while an issue it's blocked by is open. It's disabled, its title saying why, while its repository is still
// onboarding or T3 has no project for its repository; blocked work then shows Start after, disabled, not Build.

import {
    startActionChoice,
    buildAccessProblem,
    openBlockers,
    sameRepo,
    type BoardData,
    type Item,
} from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useId } from 'react';

import { ICON } from './ButtonIcons';
import { HumanWaitAction } from './HumanWaitAction';
import { hasLiveThread } from './ItemThreads';
import { OpenThread } from './OpenThread';
import { useOnRow } from './RowContext';
import { HeldStartAfter, StartOrAfter } from './StartAfter';
import { StartGroup, StartNote, useButtonKind } from '@/ui/board';

/** The shared action choice names the build on every surface. */
export function StartBuild({
    item,
    data,
    linkedBeside,
    captionReason = false,
}: {
    item: Item;
    data: BoardData;
    linkedBeside?: string | undefined;
    /** Shows why it's disabled as a quiet caption beside it, as the dialog's footer does; elsewhere the title says. */
    captionReason?: boolean;
}) {
    const kindOf = useButtonKind();
    const short = useOnRow();
    const onRow = short;
    const reasonId = useId();
    const { label } = startActionChoice(item, 'build');

    if (item.briefApproval) return <HumanWaitAction item={item} data={data} />;

    // A thread already at work on the item would get a second one.
    if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;

    const setup = data.repos.find((repo) => sameRepo(repo.repo, item.repo))?.setup;
    const problem = setup && buildAccessProblem(setup.access);

    // In the dialog's footer the reason it's disabled shows beside it as a quiet caption; elsewhere its title says.
    const reason = problem && captionReason ? <StartNote id={reasonId}>{problem}</StartNote> : undefined;

    // Blocked work says what it starts after, as every blocked start does, never a disabled Build: disabled while builds
    // lack access, its title saying why. One armed before access lapsed still shows, so it can be disarmed.
    if (problem && openBlockers(item).length && !data.armed?.[item.id])
        return (
            <HeldStartAfter item={item} data={data} kind="build" reason={problem} unavailable>
                {reason}
            </HeldStartAfter>
        );

    if (problem)
        return (
            <StartGroup>
                {reason}
                <Button
                    {...kindOf(onRow ? 'start' : 'main')}
                    leftIcon={ICON.play}
                    disabled
                    title={problem}
                    aria-describedby={reason && reasonId}
                    data-build-unavailable={item.id}
                >
                    {label}
                </Button>
            </StartGroup>
        );

    return <StartOrAfter item={item} data={data} kind="build" linkedBeside={linkedBeside} />;
}
