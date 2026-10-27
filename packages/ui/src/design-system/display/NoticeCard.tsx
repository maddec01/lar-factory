import { type ReactNode, useId } from 'react';

import type { StatusTone } from '../feedback/StatusIndicator';
import { Heading, Text } from '../typography/Typography';
import { toneTileClasses } from './ToneTile';

const accentClasses: Record<StatusTone, string> = {
    neutral: 'border-l-base-300',
    success: 'border-l-success',
    warning: 'border-l-warning',
    danger: 'border-l-danger',
    info: 'border-l-info',
};

interface NoticeCardProps {
    /** Buttons for what can be done, primary first. */
    actions?: ReactNode;
    /** A short status such as a severity, beside the title. */
    badge?: ReactNode;
    children?: ReactNode;
    description: ReactNode;
    /** Quiet content under the actions, such as a disclosure of technical details. */
    footer?: ReactNode;
    icon: ReactNode;
    /** The title's heading level; one below the section the card sits in. */
    level?: 'h2' | 'h3' | 'h4';
    title: string;
    tone: StatusTone;
}

/**
 * A persistent, substantial item that needs examination or a decision, with optional details and
 * actions. Use Alert for current status, InfoBox for optional guidance, and InsetPanel for grouping.
 */
export function NoticeCard({
    actions,
    badge,
    children,
    description,
    footer,
    icon,
    level = 'h2',
    title,
    tone,
}: NoticeCardProps) {
    const id = useId();

    return (
        <article
            aria-labelledby={id}
            className={`rounded-lg border border-l-4 border-base-300 bg-base-100 p-4 sm:p-5 ${accentClasses[tone]}`}
        >
            <div className="flex min-w-0 gap-3 sm:gap-4">
                <span
                    aria-hidden="true"
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-5 ${toneTileClasses[tone]}`}
                >
                    {icon}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <Heading id={id} as={level} variant="title">
                                {title}
                            </Heading>
                            {badge}
                        </div>
                        <Text tone="muted">{description}</Text>
                    </div>
                    {children}
                    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                    {footer}
                </div>
            </div>
        </article>
    );
}
