import { AttentionList, BrandMark } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';

interface BoardWarningsProps {
    /** A warning shown open above the rest, such as a lost board server, which every number on the page depends on: a
     *  BoardWarning. It turns the list's tone to danger and keeps it open. */
    lead?: ReactNode;
    /** The list's header when only `lead` shows, such as "Board disconnected". */
    leadTitle?: string;
    /** The list's header, such as "2 connections need attention"; without it, only the lead. */
    summary?: string;
    /** Names the header's fold toggle for screen readers, such as "Show connection warnings". */
    toggleLabel: string;
    /** The warnings, each a BoardWarning. */
    children?: ReactNode;
    /** At the header's end, such as Diagnostics. */
    action: ReactNode;
}

/** The board's warnings, above the desk: the design system's AttentionList, as lar-server's "Needs attention", folded
 *  under its header until opened (inline details that never open a notification or a dialog). A lead warning, such as
 *  a lost board server, opens it in the danger tone. */
export function BoardWarnings({ lead, leadTitle, summary, toggleLabel, children, action }: BoardWarningsProps) {
    return (
        <aside data-board-notices className="shrink-0 px-6 pt-4">
            <AttentionList
                title={summary ?? leadTitle ?? ''}
                tone={lead ? 'danger' : 'warning'}
                action={action}
                collapsible={summary ? { defaultOpen: Boolean(lead), toggleLabel } : undefined}
            >
                {lead}
                {summary ? children : null}
            </AttentionList>
        </aside>
    );
}

interface BoardWarningProps {
    /** What the warning is about, as `data-warning`. */
    name: string;
    /** The warning's title. */
    title: string;
    /** The close button's accessible name. */
    dismissLabel: string;
    /** Called as the reader closes the warning. */
    onDismiss: (event: MouseEvent<HTMLButtonElement>) => void;
    /** At the row's end, such as a button that fixes it. */
    action?: ReactNode;
    /** What to do about it. */
    children: ReactNode;
    /** `danger` for a warning every number on the page depends on, such as a lost board server. */
    tone?: 'warning' | 'danger';
}

/** One warning in the list: an AttentionList row with its title, what to do, its action and a close button. Commands
 *  in it wrap anywhere. */
export function BoardWarning({
    name,
    title,
    dismissLabel,
    onDismiss,
    action,
    children,
    tone = 'warning',
}: BoardWarningProps) {
    return (
        <AttentionList.Item
            data-slot="notice"
            data-warning={name}
            tone={tone}
            title={title}
            description={children}
            action={action}
            dismissLabel={dismissLabel}
            onDismiss={onDismiss}
        />
    );
}

/** What fills the board's main area while a tool it can't work without is missing: the Lar mark, what's missing, why
 *  and how to fix it, and a way to look again. */
export function ToolMissing({
    title,
    children,
    action,
}: {
    /** What's missing. */
    title: string;
    /** Why it matters and how to fix it. */
    children: ReactNode;
    /** The way to look again. */
    action: ReactNode;
}) {
    return (
        <div className="tool-missing grid flex-1 place-items-center p-5">
            <div
                className="tool-missing-box bg-surface-raised [&_code]:text-fg max-w-130 rounded-lg border px-6 py-5 [&_code]:wrap-anywhere"
                role="alert"
            >
                <BrandMark label="Lar" />
                <h1 className="tracking-heading mt-3 mb-0 text-(length:--text-base) font-semibold">{title}</h1>
                <p className="text-fg-muted mt-3 mb-0">{children}</p>
                <p className="text-fg-muted mt-3 mb-0">{action}</p>
            </div>
        </div>
    );
}
