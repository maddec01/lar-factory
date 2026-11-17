// What a row says its T3 thread is doing, in its state cell: a status mark, then the newest action (or the state's own
// word) and its age, on one line; the agents at work in its tooltip and the item dialog. Every other state a row's cell
// shows leads with the same mark (StateMark), so the cell reads the same down every list.

import { statusStateColors, Tooltip, TooltipTrigger } from '@lar-works/design-system';
import { TooltipPopupBase } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { DetailsHeading } from './ItemDetailSections';
import { MARK_STROKE } from './StatusColors';
import { MetaDot } from './TextParts';

/** What a thread's activity line says it is doing. */
export type ActivityState = 'working' | 'quiet' | 'waiting' | 'stopped' | 'unavailable';

/** Quiet is hollow and stopped is square, so each reads apart from working without its colour. */
const MARK: Record<ActivityState, string> = {
    working: 'rounded-full bg-board-active',
    quiet: `rounded-full ${MARK_STROKE} border-warning-fg`,
    waiting: 'rounded-full bg-board-you',
    stopped: 'rounded-xs bg-board-idle',
    unavailable: `rounded-full ${MARK_STROKE} border-board-idle`,
};

/** A row state cell's mark: a thread's activity state, `blocked` (red) for what holds it, or `none`, which keeps the
 *  mark's room so every state's words start at the same place down a list. */
export function StateMark({ state }: { state: ActivityState | 'blocked' | 'none' }) {
    return (
        <span
            data-mark={state}
            aria-hidden="true"
            className={`inline-block size-2 shrink-0 ${state === 'none' ? '' : state === 'blocked' ? 'rounded-full' : MARK[state]}`}
            style={state === 'blocked' ? { background: statusStateColors.failed } : undefined}
        />
    );
}

/** A path in the line's words as its file's name, such as "bitmap.ts"; the line's tooltip keeps the path. */
const short = (words: ReactNode) =>
    typeof words === 'string' ? words.replace(/(?:[\w.@-]+\/)+([\w.@-]+)/g, '$1') : words;

/** The line's words for its state, which `data-action` marks. */
function Words({ state, children: words }: { state: ActivityState; children: ReactNode }) {
    const children = short(words);

    switch (state) {
        case 'working':
            return (
                <span data-action className="text-fg min-w-0 truncate">
                    {children}
                </span>
            );
        case 'quiet':
            return (
                <span data-action className="text-fg min-w-0 truncate tabular-nums">
                    {children}
                </span>
            );
        case 'waiting':
            return (
                <span data-action className="text-fg min-w-0 truncate font-medium">
                    {children}
                </span>
            );
        case 'stopped':
            return (
                <span data-action className="min-w-0 truncate">
                    {children}
                </span>
            );
        case 'unavailable':
            return (
                <span data-action className="min-w-0 truncate">
                    {children}
                </span>
            );
    }
}

/**
 * A thread's activity on one line: its state's mark, its `action` (or, given, the state's `word`, such as "Fixing review
 * feedback"), then its `age` after a dot. Its tooltip says the action, its age, how many `agents` work and any `detail`
 * in full; with `agentList`, the line takes focus and its tooltip lists the agents at work.
 */
export function ActivityLine({
    state,
    action,
    word,
    detail,
    age,
    agents,
    agentList,
}: {
    /** The state in a short word, shown in place of the action, which then reads in the tooltip. */
    word?: string | undefined;
    /** More on the state, such as a failed Verify's note, in the tooltip. */
    detail?: string | undefined;
    /** The thread's state, which picks its mark: `working`, `quiet`, `waiting`, `stopped` or `unavailable`. */
    state: ActivityState;
    /** What the thread is doing, such as its last tool call. */
    action: ReactNode;
    /** How long ago the action began, after a dot. */
    age?: string | undefined;
    /** How many agents work, in words, after a dot. */
    agents?: string | undefined;
    /** The agents at work, an AgentList, shown in a tooltip as the line takes focus. */
    agentList?: ReactNode;
}) {
    const said = [word, typeof action === 'string' && action, age, agents].filter(Boolean).join(' · ');
    const shown = (
        <span
            data-activity={state}
            title={[said, detail].filter(Boolean).join('\n')}
            tabIndex={agentList ? 0 : undefined}
            className="focus-ring flex max-w-full min-w-0 flex-nowrap items-center gap-1.5 rounded-xs whitespace-nowrap"
        >
            <StateMark state={state} />
            {word ? (
                <span data-action data-word className="text-fg min-w-0 truncate font-medium">
                    {word}
                </span>
            ) : (
                <Words state={state}>{action}</Words>
            )}
            {age !== undefined && (
                <span data-age className="shrink-0 tabular-nums">
                    <MetaDot /> {age}
                </span>
            )}
        </span>
    );

    if (!agentList) return shown;

    return (
        <Tooltip>
            <TooltipTrigger asChild>{shown}</TooltipTrigger>
            <TooltipPopupBase side="bottom" align="start" className="max-w-md">
                {agentList}
            </TooltipPopupBase>
        </Tooltip>
    );
}

/** The agents at work, one AgentRow each. */
export function AgentList({
    children,
}: {
    /** The agents, one AgentRow each. */
    children: ReactNode;
}) {
    return (
        <ul data-agent-list className="m-0 grid min-w-0 list-none gap-1 p-0 text-left">
            {children}
        </ul>
    );
}

/** An agent at work: its title, any `model` after it, its action's `age` at the right, and its `action` under it. */
export function AgentRow({
    title,
    model,
    age,
    action,
    state = 'working',
}: {
    /** The agent's title, such as its thread's name. */
    title: string;
    /** The agent’s activity state; waiting uses the same attention mark as its item. */
    state?: ActivityState;
    /** The model it runs on, after the title. */
    model?: string | undefined;
    /** How long ago its action began, an AgentAge at the right. */
    age?: ReactNode;
    /** What it is doing, under its title. */
    action?: string | undefined;
}) {
    return (
        <li data-agent-state={state} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-1.5">
            <span className={`inline-block size-2 self-center ${MARK[state]}`} />
            <span className="flex min-w-0 gap-1.5">
                <span className="min-w-0 truncate font-medium">{title}</span>
                {model && (
                    <span className="text-fg-muted shrink-0">
                        <MetaDot /> {model}
                    </span>
                )}
            </span>
            {age || <span />}
            {action && (
                <span title={action} className="text-fg-muted col-span-2 col-start-2 truncate">
                    {action}
                </span>
            )}
        </li>
    );
}

/** An agent's action's age, in AgentRow. */
export function AgentAge({
    children,
}: {
    /** The age, such as "2m". */
    children: ReactNode;
}) {
    return (
        <span data-agent-age className="text-fg-muted shrink-0 tabular-nums">
            {children}
        </span>
    );
}

/** The agents at work in the item dialog, under `heading` in the dialog's section heading style; or, with `unavailable`,
 *  why they can't be listed. */
export function WorkingAgents({
    heading,
    unavailable,
    children,
}: {
    /** The section's heading, such as "Working agents". */
    heading: string;
    /** Why the agents can't be listed, in their place. */
    unavailable?: string | undefined;
    /** The agents, one AgentRow each. */
    children?: ReactNode;
}) {
    return (
        <section data-working-agents className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 text-xs">
            {unavailable ? (
                <p className="text-fg-muted m-0">{unavailable}</p>
            ) : (
                <>
                    <DetailsHeading presentation="label">{heading}</DetailsHeading>
                    {children}
                </>
            )}
        </section>
    );
}
