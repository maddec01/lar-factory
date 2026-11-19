// Start after arms a blocked item's start on a model choice. At capacity, Build arms the same start with its saved
// model; the chevron can choose another model or explicitly start over the limit. The server starts armed work
// once its prerequisites and capacity allow it. Pressing an armed start again disarms it; a failed start leaves
// its error on the item. StartOrAfter supplies this behavior wherever work starts.

import type { BoardData, Item, ModelChoice } from '@lar-factory/shared';
import {
    startActionChoice,
    blockerGroups,
    buildWaitsForSlot,
    itemName,
    openBlockerRefs,
    openBlockers,
    ref,
    startAfterRef,
    startHold,
    startRequest,
} from '@lar-factory/shared';
import { Button, DropdownMenu } from '@lar-works/design-system';
import { ChevronDownIcon } from '@lar-works/design-system/icons';
import { useId, useRef, useState, type ReactElement } from 'react';
import { flushSync } from 'react-dom';

import { writeState } from './ActionAvailability';
import { ICON } from './ButtonIcons';
import { opensOnChecked } from './ModelMenuFocus';
import { useOnRow } from './RowContext';
import { StartControl } from './StartControl';
import { StartEntries } from './StartEntries';
import type { StartKind } from './StartStore';
import { closeKeepingFocus, notify, refocus } from '@/features/notices';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { ActionError, StartAfterButton, StartGroup, StartLine, StartNote, useButtonKind } from '@/ui/board';

/** The open blocker Start after waits for in full, the last one when several are open; null once none is. */
const startsAfter = (item: Item): string | null => openBlockerRefs(item).at(-1) ?? null;

/** What the title says Start after waits for: every open blocker's work, and the user's mark on each unmet Dependency. */
function waitsFor(item: Item): string {
    const { work, dependencies } = blockerGroups(item);

    return [
        ...(work ? [`${work.names} ${work.many ? 'complete' : 'completes'}`] : []),
        ...(dependencies ? [`you mark ${dependencies.names} met`] : []),
    ].join(' and ');
}

/** Arms the item's start on `choice`, or disarms it with `null`; a refusal shows as a toast. */
async function setArmed(item: Item, choice: ModelChoice | undefined | null): Promise<void> {
    const session = useBoardStore.getState().data.capture?.session;
    const result =
        choice === null
            ? await postAction('/api/disarm', { session, itemId: item.id })
            : await postAction('/api/arm', startRequest(session, item.id, choice));

    flushSync(() => {
        receive(result);

        if (result.error) notify({ verb: 'Failed', item, message: result.error });
    });
    refocus([`[data-start-after="${CSS.escape(item.id)}"]`, `[data-start="${CSS.escape(item.id)}"]`]);
}

/** Start after #n (or Part n, or Start when unblocked), or Starts after #n ✓ while armed, a Start. */
function StartAfter({ item, data, kind }: { item: Item; data: BoardData; kind: StartKind }) {
    const kindOf = useButtonKind();
    const onRow = useOnRow();
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);
    const after = startsAfter(item);
    const slot = !openBlockers(item).length && kind === 'build';

    const armed = !!data.armed?.[item.id];
    // The button names it shortly (#n, Part n, or when unblocked); its tooltip names every blocker in full.
    const label = slot
        ? 'Starts after a slot frees'
        : startActionChoice(item, kind, { prerequisite: startAfterRef(item, data.items), armed }).label;
    const writes = pending ? { 'aria-disabled': true as const } : writeState(data);
    const held = Boolean(writes['aria-disabled']);
    const run = async (choice: ModelChoice | undefined | null) => {
        if (inFlight.current) return;

        inFlight.current = true;
        setPending(true);

        try {
            await setArmed(item, choice);
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    };

    if (armed) {
        return (
            <StartAfterButton
                {...kindOf(onRow ? 'start' : 'main')}
                leftIcon={ICON.play}
                mark="✓"
                data-start-after={item.id}
                aria-pressed
                aria-label={`${label} for ${itemName(item)}`}
                title={`Starts by itself once ${slot ? 'a build slot frees' : waitsFor(item)}. Pressing it again disarms it`}
                {...writes}
                onClick={() => !held && void run(null)}
            >
                {label}
            </StartAfterButton>
        );
    }

    if (slot) return <StartControl item={item} data={data} kind={kind} afterSlot={{ pending, arm: run }} />;

    if (!after) return null;

    const pick = (choice: ModelChoice | undefined) => {
        flushSync(() => setOpen(false));
        void run(choice);
    };

    // Sample mode keeps the menu open-able, so the model choices can be seen; its entries arm nothing.
    return (
        <DropdownMenu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
            <DropdownMenu.Trigger asChild>
                <StartAfterButton
                    {...kindOf(onRow ? 'start' : 'main')}
                    leftIcon={ICON.play}
                    rightIcon={<ChevronDownIcon />}
                    data-start-after={item.id}
                    aria-label={`${label} for ${itemName(item)}`}
                    title={`Pick a model to start it once ${waitsFor(item)}`}
                    {...(data.capture?.enabled === false ? {} : writes)}
                >
                    {label}
                </StartAfterButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
                width="md"
                height="capped"
                align="end"
                aria-label={`Start ${ref(item)} after ${after} with`}
                {...opensOnChecked}
            >
                <StartEntries item={item} data={data} onPick={pick} />
            </DropdownMenu.Content>
        </DropdownMenu>
    );
}

/** Keep armed starts visible through capacity changes, so they can still be disarmed. */
const showsStartAfter = (item: Item, data: BoardData, kind: StartKind): boolean =>
    (openBlockers(item).length > 0 ||
        (kind === 'build' &&
            (buildWaitsForSlot(item, data) || (item.status === 'Ready' && !!data.armed?.[item.id])))) &&
    (!startHold(data, item.repo) || !!data.armed?.[item.id]);

/**
 * The item's Start, the StartControl named `label`, while nothing holds it. An open blocker holds it, and so does its
 * repository, where a refining thread and a build both start, while it is still onboarding or T3 has no project for
 * it. While a blocker holds it, Start after takes its place. While only the repository holds it, Start shows
 * disabled, with the hold's reason beside it; an armed start would fail then, so a blocked item's Start after shows
 * disabled with that reason, but one armed before the hold still shows while a blocker is open, so it can be disarmed. Beside text that names the blockers,
 * The action always names the work and prerequisite.
 */
export function StartOrAfter({
    item,
    data,
    kind = 'refine',
    linkedBeside,
}: {
    item: Item;
    data: BoardData;
    kind?: StartKind;
    linkedBeside?: string | undefined;
}) {
    const kindOf = useButtonKind();
    const onRow = useOnRow();
    const reasonId = useId();

    const { label } = startActionChoice(item, kind);

    if (showsStartAfter(item, data, kind)) return <StartAfter item={item} data={data} kind={kind} />;

    const hold = startHold(data, item.repo);

    // Blocked and held by its repository too, it names what it starts after as every blocked start does, disabled, with
    // the hold's reason beside it.
    if (hold && openBlockers(item).length)
        return (
            <HeldStartAfter item={item} data={data} kind={kind} reason={hold}>
                <StartNote id={reasonId}>{hold}</StartNote>
            </HeldStartAfter>
        );

    if (!hold) return <StartControl item={item} data={data} kind={kind} linkedBeside={linkedBeside} />;

    return (
        <StartGroup>
            <StartNote id={reasonId}>{hold}</StartNote>
            <Button
                {...kindOf(onRow ? 'start' : 'main')}
                leftIcon={ICON.play}
                data-start={item.id}
                disabled
                title={hold}
                aria-describedby={reasonId}
            >
                {label}
            </Button>
        </StartGroup>
    );
}

/**
 * Start after for blocked work that can't be armed yet, because its repository holds starts or builds lack access:
 * disabled, in the words every blocked start uses ("Start after #139"), its title saying why. `children` is the reason
 * as a line beside it, where the surface shows one; the button points at it as its description.
 */
export function HeldStartAfter({
    item,
    data,
    kind,
    reason,
    children,
    unavailable,
}: {
    item: Item;
    data: BoardData;
    kind: StartKind;
    reason: string;
    children?: ReactElement<{ id: string }> | undefined;
    /** Set when build access holds it, as `data-build-unavailable`, as the disabled Build it replaces was marked. */
    unavailable?: boolean;
}) {
    const kindOf = useButtonKind();
    const onRow = useOnRow();
    const { label } = startActionChoice(item, kind, { prerequisite: startAfterRef(item, data.items), armed: false });

    return (
        <StartGroup>
            {children}
            <StartAfterButton
                {...kindOf(onRow ? 'start' : 'main')}
                leftIcon={ICON.play}
                data-start={unavailable ? undefined : item.id}
                data-build-unavailable={unavailable ? item.id : undefined}
                disabled
                title={reason}
                aria-describedby={children?.props.id}
            >
                {label}
            </StartAfterButton>
        </StartGroup>
    );
}

/** Why the start the board ran by itself failed; dismissing it clears it on the server. */
export function StartAfterError({ item, data }: { item: Item; data: BoardData }) {
    const el = useRef<HTMLDivElement>(null);
    const error = data.armedErrors?.[item.id];

    if (!error) return null;

    const id = CSS.escape(item.id);
    const close = () =>
        closeKeepingFocus(el.current, () => void setArmed(item, null), [
            `[data-start-after="${id}"]`,
            `[data-start="${id}"]`,
        ]);

    return (
        <StartLine ref={el} data-start-after-error={item.id}>
            <ActionError dismissLabel={`Dismiss Start after error for ${ref(item)}`} onDismiss={close}>
                Start after failed: {error}
            </ActionError>
        </StartLine>
    );
}
