import { Alert } from '@lar-works/design-system';
import { scrollFadeClassName, useScrollFade } from '@lar-works/design-system/primitives';
import { type ReactNode, type Ref, useCallback } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The editor's slot in a main section: a column that takes the height left when it `fill`s, named in `data-editor-slot`. */
export function EditorSlot({
    fill,
    children,
}: {
    /** The editor takes the height left in its section. */
    fill: boolean;
    /** The editor. */
    children: ReactNode;
}) {
    return (
        <div data-editor-slot={fill ? 'fill' : 'flow'} className={fill ? 'flex min-h-0 flex-col' : 'contents'}>
            {children}
        </div>
    );
}

/** Under an editor: whether it changed, or `error` in its place, announced and wrapping, then its buttons. */
export function EditActions({
    status,
    error,
    children,
    ...data
}: {
    /** Whether the editor changed, such as "Unsaved changes". */
    status: string;
    /** Why the save failed, announced, in the status's place. */
    error?: string | null | undefined;
    /** The editor's buttons. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="flex items-start gap-2">
            {error ? (
                <Alert size="sm" tone="danger" message={error} />
            ) : (
                <span className="text-fg-muted me-auto min-w-0 flex-1 py-1.5 text-xs">{status}</span>
            )}
            {children}
        </div>
    );
}

/** How a Spec's sync stands: its `status`, announced, then what answers it, then an `error`, announced. */
export function SpecSync({
    status,
    error,
    children,
}: {
    /** How the Spec's sync stands, announced. */
    status?: string | undefined;
    /** Why the sync failed, announced. */
    error?: string | null | undefined;
    /** What answers the status, such as a retry. */
    children?: ReactNode;
}) {
    return (
        <div className="grid gap-2 text-sm" data-spec-sync>
            {status && (
                <p className="m-0" role="status">
                    {status}
                </p>
            )}
            {children}
            {error && <Alert size="sm" tone="danger" message={error} />}
        </div>
    );
}

/** A popover's panel for picking labels: 18rem wide, its picker over its status. */
export function LabelEditorPanel({
    children,
}: {
    /** The label picker and its status. */
    children: ReactNode;
}) {
    return <div className="grid w-72 gap-2">{children}</div>;
}

/** A kind change that failed: each of its `lines`, then the `action` that retries it, announced. */
export function ChangeFailed({
    lines,
    action,
    ...data
}: {
    /** What failed, a line each. */
    lines: readonly string[];
    /** The button that retries. */
    action: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="w-full">
            <Alert
                size="sm"
                tone="danger"
                message={lines.map((line, index) => (
                    <p key={index} className="m-0">
                        {line}
                    </p>
                ))}
                action={action}
            />
        </div>
    );
}

/** Where the item's kind and its ticket's disagree: the `message`, the `actions` that answer it, then a `hint` and any
 *  `error`, which the caller renders as caption Text. */
export function KindQuestion({
    message,
    actions,
    children,
    ...data
}: {
    /** Where the item's kind and its ticket's disagree. */
    message: string;
    /** The buttons that answer it. */
    actions: ReactNode;
    /** A hint and any error, under the actions. */
    children?: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="w-full min-w-0">
            <Alert
                size="sm"
                tone="info"
                message={message}
                action={
                    <div className="grid gap-2">
                        <span className="flex flex-wrap gap-2">{actions}</span>
                        {children}
                    </div>
                }
            />
        </div>
    );
}

/** A ticket's outgoing title and text, as the tracker will receive them; the labels name each for assistive
 *  technology. */
export function OutgoingTicket({
    title,
    text,
    titleLabel,
    textLabel,
}: {
    /** The ticket's title, as the tracker will receive it. */
    title: string;
    /** The ticket's text, as the tracker will receive it. */
    text: string;
    /** Names the title for assistive technology. */
    titleLabel: string;
    /** Names the text for assistive technology. */
    textLabel: string;
}) {
    const { setViewport } = useScrollFade();

    return (
        <>
            <div aria-label={titleLabel} className="font-medium wrap-anywhere">
                {title}
            </div>
            <pre
                ref={setViewport}
                aria-label={textLabel}
                className={`m-0 max-h-64 overflow-y-auto text-xs wrap-anywhere whitespace-pre-wrap ${scrollFadeClassName}`}
            >
                {text}
            </pre>
        </>
    );
}

/** A check's run: its `command`, then what it says of the run. */
export function CheckRun({
    command,
    children,
}: {
    /** The check's command. */
    command: string;
    /** What the check says of the run. */
    children: ReactNode;
}) {
    return (
        <section className="border-line min-w-0 rounded-xs border p-2">
            <code className="wrap-anywhere whitespace-pre-wrap">{command}</code>
            {children}
        </section>
    );
}

/** A section's own scrolling panel that focus moves to when it opens, such as Create issue's; `label` names it. */
export function FocusPanel({
    label,
    ref,
    children,
}: {
    /** Names the panel. */
    label: string;
    /** The panel's element, which takes focus as it opens. */
    ref?: Ref<HTMLElement>;
    /** The panel's content. */
    children: ReactNode;
}) {
    const { setViewport } = useScrollFade();
    const panelRef = useCallback(
        (element: HTMLElement | null) => {
            setViewport(element);

            if (typeof ref === 'function') ref(element);
            else if (ref) ref.current = element;
        },
        [ref, setViewport],
    );

    return (
        <section
            ref={panelRef}
            tabIndex={-1}
            aria-label={label}
            className={`grid max-h-[50dvh] w-full gap-3 overflow-y-auto pt-1 ${scrollFadeClassName}`}
        >
            {children}
        </section>
    );
}
