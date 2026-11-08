import type { BoardData, Item, ModelChoice } from '@lar-factory/shared';
// Start on a Queued item, or Start build on a Ready one, as a menu button: Start opens a menu on
// the highlighted entry, arrow keys move, Enter or a click picks and starts, and Escape, Tab or a
// click outside closes it.
// Once a thread starts or may have started, a tag takes Start's place.
import {
    canResumeShaping,
    canRetryBuild,
    currentBuildThread,
    delegatedWorkRunning,
    highlightedChoice,
    itemName,
    ref,
    repositoryT3Default,
    startProgressOf,
} from '@lar-factory/shared';
import { Button, DropdownMenu } from '@lar-works/design-system';
import { ChevronDownIcon } from '@lar-works/design-system/icons';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { writeState } from './ActionAvailability';
import { useItemAction } from './ActionStore';
import { ICON } from './ButtonIcons';
import { ModelEntries } from './ModelEntries';
import { opensOnChecked } from './ModelMenuFocus';
import { OpenThread } from './OpenThread';
import { useOnRow } from './RowContext';
import { startItem } from './StartItem';
import type { StartKind } from './StartStore';
import { PURPOSE, useStart, useStartStore } from './StartStore';
import { startedThread, useShownStart } from './useShownStart';
import { closeKeepingFocus, DismissButton, notify } from '@/features/notices';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { ActionError, buttonKind, StartGroup, StartLine, StartNote, StartTag } from '@/ui/board';

/** "Project default in T3", then each provider instance's models, with the remembered choice checked. Sample mode shows them but starts nothing. */
export function StartEntries({
    item,
    data,
    onPick,
    requireModel = false,
}: {
    item: Item;
    data: BoardData;
    requireModel?: boolean;
    onPick: (choice: ModelChoice | undefined) => void;
}) {
    const lastChoice = useStartStore((state) => state.lastChoice);

    return (
        <ModelEntries
            groups={data.modelChoices}
            t3Default={repositoryT3Default(data, item.repo)}
            selected={highlightedChoice(data.modelChoices, lastChoice)}
            heading="Start with"
            held={data.capture?.enabled === false ? 'Disabled in sample mode' : undefined}
            defaultHeld={requireModel ? 'Choose a model to continue in the existing worktree.' : undefined}
            itemId={item.id}
            onPick={onPick}
        />
    );
}

/**
 * Start, a Start button named `label`, or the tag that took its place. `linkedBeside` names a thread Open thread
 * already links beside it, so a finished or stopped run doesn't link it again.
 */
export function StartControl({
    item,
    data,
    label = 'Start',
    kind = 'refine',
    linkedBeside,
}: {
    item: Item;
    data: BoardData;
    label?: string;
    kind?: StartKind;
    linkedBeside?: string | undefined;
}) {
    const onRow = useOnRow();
    const { pending, uncertain, error } = useShownStart(item, data, kind);
    const closed = useStart(item.id, kind)?.phase === 'closed';
    const action = useItemAction(item.id);
    const [open, setOpen] = useState(false);
    const thread = startedThread(item, data, kind);
    const threads = Array.isArray(item.threads) ? item.threads : [];
    // An unrecorded shaping thread can explain refining, but never a build that hasn't started.
    const recorded = thread ? threads.find((t) => t.id === thread.threadId) : undefined;
    const resume = kind === 'refine' && canResumeShaping(item) && (!thread || recorded);
    const observed = resume
        ? (threads.find((t) => t.purpose === 'shape') ?? threads[0])
        : thread
          ? recorded
          : kind === 'refine'
            ? threads.find((t) => t.id !== data.startedBuilds?.[item.id]?.threadId)
            : undefined;
    const stopped = observed?.state === 'stopped';

    if (thread && observed?.state === 'done') {
        return (
            <StartGroup>
                <StartNote>
                    {delegatedWorkRunning(item) || observed.hasRunningChildren
                        ? 'Working. Parent run finished.'
                        : 'Run finished.'}
                </StartNote>
                {observed.id !== linkedBeside && <OpenThread item={item} data={data} threadId={observed.id} />}
            </StartGroup>
        );
    }

    // The toast announces a start; the tag only keeps Start from running twice.
    if (thread && !stopped && !pending)
        return (
            <StartGroup>
                <StartTag data-start-result={item.id} title={`T3 thread ${thread.threadId}`}>
                    Started
                </StartTag>
            </StartGroup>
        );

    if (uncertain) {
        // Once its message is closed, a tag still says why Start is gone.
        return (
            <StartGroup>
                {closed && (
                    <StartTag unsure data-start-result={item.id} title="Check T3 before starting it again">
                        May have started
                    </StartTag>
                )}
            </StartGroup>
        );
    }

    const retry = kind === 'build' && canRetryBuild(item);
    const verb = pending ? 'Starting…' : error || retry ? 'Retry start' : stopped && !resume ? 'Start again' : label;
    // Sample mode keeps Start's menu open-able, so the model choices can be seen; its entries start nothing.
    const state =
        data.capture?.enabled === false ? {} : pending ? { 'aria-disabled': true as const } : writeState(data, action);
    const held = Boolean(state['aria-disabled']);
    const pick = (choice: ModelChoice | undefined) => {
        // Close first, so focus is back on Start before it relabels.
        flushSync(() => setOpen(false));
        void startItem(item.id, choice, kind);
    };

    return (
        <StartGroup>
            {retry
                ? currentBuildThread(item)?.id !== linkedBeside && (
                      <OpenThread item={item} data={data} iconOnly threadId={currentBuildThread(item)?.id} />
                  )
                : stopped && (
                      <>
                          {observed.id !== linkedBeside && (
                              <OpenThread item={item} data={data} threadId={observed.id} />
                          )}
                      </>
                  )}
            <DropdownMenu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
                <DropdownMenu.Trigger asChild>
                    <Button
                        {...buttonKind(onRow ? 'start' : 'main')}
                        busy={pending}
                        leftIcon={!retry && ICON.play}
                        rightIcon={!pending && <ChevronDownIcon />}
                        data-start={item.id}
                        aria-label={`${verb} ${itemName(item)}`}
                        {...state}
                    >
                        {verb}
                    </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content
                    width="lg"
                    height="capped"
                    align="end"
                    aria-label={`Start ${ref(item)} with`}
                    {...opensOnChecked}
                >
                    <StartEntries item={item} data={data} onPick={pick} />
                </DropdownMenu.Content>
            </DropdownMenu>
        </StartGroup>
    );
}

/** Clears a failed start on every page, or a failure only this page holds. */
async function dismissFailure(item: Item, kind: StartKind): Promise<void> {
    useStartStore.getState().set(item.id, undefined, kind);

    const session = useBoardStore.getState().data.capture?.session;
    const result = await postAction('/api/dismiss-start-error', { session, itemId: item.id, purpose: PURPOSE[kind] });

    flushSync(() => {
        receive(result);

        if (result.error) notify({ verb: 'Failed', item, startError: true, message: result.error });
    });
}

/** Why Start failed, or that it may have run. Closing it keeps an unconfirmed start's tag. */
export function StartMessage({ item, kind = 'refine' }: { item: Item; kind?: StartKind }) {
    const data = useBoardStore((state) => state.data);
    const local = useStart(item.id, kind);
    const server = startProgressOf(data, item.id, PURPOSE[kind]);
    const el = useRef<HTMLParagraphElement>(null);
    const uncertain = server?.phase === 'may-have-started';
    const message =
        server?.phase === 'failed' || uncertain
            ? local?.phase === 'closed' && uncertain
                ? undefined
                : server.message
            : local?.phase === 'error'
              ? local.message
              : undefined;

    if (!message) return null;

    const id = CSS.escape(item.id);
    const close = () =>
        closeKeepingFocus(
            el.current,
            () => {
                if (uncertain) useStartStore.getState().set(item.id, { phase: 'closed' }, kind);
                else void dismissFailure(item, kind);
            },
            [`[data-back-to-list="${id}"]`, `[data-start="${id}"]`, `[data-start-result="${id}"]`],
        );

    return (
        <StartLine ref={el} {...(uncertain && { tabIndex: -1, 'data-start-result': item.id })}>
            <ActionError>
                <span role="alert">{message}</span>{' '}
                <DismissButton inline what={` error for ${ref(item)}`} onClick={close} />
            </ActionError>
        </StartLine>
    );
}
