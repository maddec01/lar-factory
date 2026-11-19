import { ScrollRowArrows, StatusIndicator, useScrollRow } from '@lar-works/design-system';
import { useScrollFade } from '@lar-works/design-system/primitives';
import { type ReactNode, useCallback, useId, useState } from 'react';

import { useArrival } from './BoardLife';
import { TintedActions } from './ButtonDensity';
import { ROW_OPENS } from './RowStyles';

export interface DeskLatest {
    title: ReactNode;
    name: string;
    detail: string;
    action: ReactNode;
    onOpen: () => void;
}

export function DeskDrawer({
    count,
    latest,
    empty,
    children,
}: {
    count: number;
    latest?: DeskLatest | undefined;
    empty: ReactNode;
    children?: ReactNode;
}) {
    const [wantsOpen, setOpen] = useState(false);
    const open = wantsOpen && count > 0;
    const cardsId = useId();
    const { setViewport, className: fade } = useScrollFade({ axis: 'horizontal', row: true });
    const { setRow, scroll, canScrollBack, canScrollForward } = useScrollRow<HTMLOListElement>(count);
    const setList = useCallback(
        (element: HTMLOListElement | null) => {
            setViewport(element);
            setRow(element);
        },
        [setViewport, setRow],
    );

    return (
        <section className="desk" data-open={open || undefined} aria-labelledby="desk-h">
            <h2 id="desk-h" className="sr-only">
                Your desk
            </h2>
            {/* Every card here is yellow, so its actions keep their outline (ButtonKinds' rule). */}
            <TintedActions tinted={false}>
                <div id={cardsId} className="desk-cards" inert={!open}>
                    <ol ref={setList} aria-label="Your desk" className={`desk-grid m-0 list-none ${fade}`}>
                        {children}
                    </ol>
                </div>
                {count > 0 && latest ? (
                    <div
                        className="desk-line"
                        onClick={(event) => {
                            if (!(event.target as Element).closest('button, a')) setOpen(!open);
                        }}
                    >
                        <StatusIndicator state="waiting" />
                        <span className="text-fg shrink-0 font-medium">{count} need you</span>
                        <span className="desk-line-latest" inert={open}>
                            <span className="desk-line-rule" aria-hidden="true" />
                            <button
                                type="button"
                                className={`desk-line-title rounded-xs ${ROW_OPENS}`}
                                title={latest.name}
                                onClick={latest.onOpen}
                            >
                                {latest.title}
                            </button>
                            <span className="desk-line-detail" title={latest.detail}>
                                {latest.detail}
                            </span>
                            <span className="wait-actions flex shrink-0 items-center gap-2">{latest.action}</span>
                        </span>
                        {open && (canScrollBack || canScrollForward) && (
                            <ScrollRowArrows
                                size="sm"
                                onScroll={scroll}
                                canScrollBack={canScrollBack}
                                canScrollForward={canScrollForward}
                                backLabel="Previous cards"
                                forwardLabel="Next cards"
                            />
                        )}
                        <button
                            type="button"
                            className="desk-line-toggle focus-ring rounded-xs"
                            aria-expanded={open}
                            aria-controls={cardsId}
                            onClick={() => setOpen(!open)}
                        >
                            {open ? 'Hide' : count > 1 ? `+${count - 1} more` : 'Show'}
                        </button>
                    </div>
                ) : (
                    <div className="desk-line" data-empty>
                        <StatusIndicator state="off" />
                        <p className="text-fg-muted m-0 flex min-w-0 items-center truncate">{empty}</p>
                    </div>
                )}
            </TintedActions>
        </section>
    );
}

export function DeskCard({ item, children }: { item: string; children: ReactNode }) {
    const arrived = useArrival('desk', item);

    return (
        <li data-item={item} data-arrived={arrived ? 'above' : undefined} data-attention className="desk-row">
            {children}
        </li>
    );
}

export function DeskHint({ children }: { children?: string | undefined }) {
    return (
        <span className="truncate" title={children}>
            {children}
        </span>
    );
}
