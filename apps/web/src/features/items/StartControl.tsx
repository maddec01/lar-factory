import type { BoardData, Item, ModelChoice } from '@lar-factory/shared';
// Start uses the remembered model, or Project default in T3. The adjacent chevron opens the model
// menu on that choice; picking an entry starts with it, while Escape, Tab or a click outside closes it.
// Once a thread starts or may have started, a tag takes Start's place.
import {
    startActionChoice,
    canResumeShaping,
    canRetryBuild,
    currentBuildThread,
    delegatedWorkRunning,
    highlightedChoice,
    itemName,
    ref,
    startProgressOf,
} from '@lar-factory/shared';
import { Button, DropdownMenu, Inline } from '@lar-works/design-system';
import { ChevronDownIcon } from '@lar-works/design-system/icons';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { writeState } from './ActionAvailability';
import { useItemAction } from './ActionStore';
import { ICON } from './ButtonIcons';
import { opensOnChecked } from './ModelMenuFocus';
import { OpenThread } from './OpenThread';
import { useOnRow } from './RowContext';
import { StartEntries } from './StartEntries';
import { startItem } from './StartItem';
import type { StartKind } from './StartStore';
import { PURPOSE, useStart, useStartStore } from './StartStore';
import { startedThread, useShownStart } from './useShownStart';
import { closeKeepingFocus, notify } from '@/features/notices';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { ActionError, StartGroup, StartLine, StartNote, StartTag, useButtonKind } from '@/ui/board';

/**
 * Start, a Start button named `label`, or the tag that took its place. `linkedBeside` names a thread Open thread
 * already links beside it, so a finished or stopped run doesn't link it again.
 */
export function StartControl({
    item,
    data,
    kind = 'refine',
    linkedBeside,
    afterSlot,
}: {
    item: Item;
    data: BoardData;
    kind?: StartKind;
    linkedBeside?: string | undefined;
    /** Reuses Start after's authorization while capacity is full. Menu models arm; the explicit override starts now. */
    afterSlot?: { pending: boolean; arm: (choice: ModelChoice | undefined) => Promise<void> };
}) {
    const { label } = startActionChoice(item, kind);
    const kindOf = useButtonKind();
    const onRow = useOnRow();
    const shown = useShownStart(item, data, kind);
    const { uncertain, error } = shown;
    const pending = shown.pending || !!afterSlot?.pending;
    const closed = useStart(item.id, kind)?.phase === 'closed';
    const action = useItemAction(item.id);
    const lastChoice = useStartStore((state) => state.lastChoice);
    const [open, setOpen] = useState(false);
    const primary = useRef<HTMLButtonElement>(null);
    const picked = useRef(false);
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

    if (thread && observed?.state === 'done' && !resume) {
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
    if (thread && !stopped && !resume && !pending)
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
    const verb = pending
        ? afterSlot
            ? 'Arming…'
            : 'Starting…'
        : error || retry
          ? 'Retry start'
          : stopped && !resume
            ? 'Start again'
            : label;
    const state = pending ? { 'aria-disabled': true as const } : writeState(data, action);
    // Sample mode keeps the chevron open-able, so the model choices can be seen; Start and the entries start nothing.
    const menuState = data.capture?.enabled === false ? {} : state;
    const held = Boolean(menuState['aria-disabled']);
    const pick = (choice: ModelChoice | undefined, now = false) => {
        if (state.disabled || state['aria-disabled']) return;

        // Menu selection returns focus to the main action before it relabels. Dismissal returns to the chevron.
        picked.current = open;
        flushSync(() => setOpen(false));

        if (afterSlot && !now) void afterSlot.arm(choice);
        else void startItem(item.id, choice, kind);
    };
    const returnAfterPick = {
        onCloseAutoFocus: (event: Event) => {
            if (!picked.current) return;

            picked.current = false;
            event.preventDefault();
            primary.current?.focus({ preventScroll: true });
        },
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
            <Inline
                as="span"
                inline
                align="center"
                space="tight"
                role="group"
                aria-label={`${label} ${itemName(item)}`}
            >
                <Button
                    ref={primary}
                    {...kindOf(onRow ? 'start' : 'main')}
                    busy={pending}
                    leftIcon={!retry && ICON.play}
                    data-start={item.id}
                    aria-label={`${verb} ${itemName(item)}`}
                    title={afterSlot ? 'Start after a slot frees' : undefined}
                    {...state}
                    onClick={() => pick(highlightedChoice(data.modelChoices, lastChoice))}
                >
                    {verb}
                </Button>
                <DropdownMenu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
                    <DropdownMenu.Trigger asChild>
                        <Button
                            {...kindOf(onRow ? 'start' : 'main')}
                            iconOnly
                            leftIcon={<ChevronDownIcon />}
                            data-start-model={item.id}
                            aria-label={`Choose ${afterSlot ? 'start options' : 'model'} for ${itemName(item)}`}
                            {...menuState}
                        />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content
                        width="md"
                        height="capped"
                        align="end"
                        aria-label={`Start ${ref(item)} with`}
                        {...opensOnChecked}
                        {...returnAfterPick}
                    >
                        {afterSlot && (
                            <>
                                <DropdownMenu.Item
                                    disabled={data.capture?.enabled === false}
                                    onSelect={() => pick(highlightedChoice(data.modelChoices, lastChoice), true)}
                                >
                                    Start now (over the limit)
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator />
                                <DropdownMenu.Label>Start after a slot frees</DropdownMenu.Label>
                            </>
                        )}
                        <StartEntries item={item} data={data} onPick={(choice) => pick(choice)} />
                    </DropdownMenu.Content>
                </DropdownMenu>
            </Inline>
            {afterSlot && !pending && <StartNote>Start after a slot frees.</StartNote>}
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
    const el = useRef<HTMLDivElement>(null);
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
            <ActionError dismissLabel={`Dismiss error for ${ref(item)}`} onDismiss={close}>
                {message}
            </ActionError>
        </StartLine>
    );
}
