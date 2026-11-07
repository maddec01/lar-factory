// The board search's field in the title bar: its tokens, folded to the room it has, and the ⌘K that opens the dialog.

import { Search } from '@lar-works/design-system/icons';
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';

import type { FilterToken } from './BoardFilters';
import { fitField } from './FieldFit';
import { useFieldRoom } from './useFieldRoom';
import { MAC } from '@/shared/ui/expand-dialog/ExpandDialog';

export const Key = ({ children }: { children: ReactNode }) => (
    <kbd className="text-2xs text-base-700 font-sans font-medium">{children}</kbd>
);

const PILL =
    'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-base-200 px-1 text-2xs font-medium text-base-800 dark:bg-base-300 dark:text-base-content [&_svg]:size-3';

function FieldToken({ token }: { token: FilterToken }) {
    const hued = token.hue !== undefined;

    return (
        <span
            title={token.label}
            className={`${PILL} ${hued ? 'kind-badge!' : ''}`}
            style={hued ? ({ '--lar-kind-hue': token.hue } as CSSProperties) : undefined}
        >
            {token.leading}
            <span className="max-w-32 min-w-0 truncate">{token.label}</span>
        </span>
    );
}

export function Field({
    button,
    tokens,
    onOpen,
}: {
    button: RefObject<HTMLButtonElement | null>;
    tokens: FilterToken[];
    onOpen: () => void;
}) {
    const wrapper = useRef<HTMLDivElement>(null);
    const ghost = useRef<HTMLDivElement>(null);
    const { room, widths } = useFieldRoom(wrapper, ghost, tokens.map(({ id }) => id).join());
    const { shown, keyHint, folded, width } = fitField(room, widths);
    const hidden = tokens.slice(shown);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() !== 'k' ||
                event.altKey ||
                event.shiftKey ||
                !(MAC ? event.metaKey : event.ctrlKey)
            )
                return;

            // An open dialog hides the page behind it, the field included.
            if (button.current?.closest('[aria-hidden="true"]')) return;

            event.preventDefault();
            onOpen();
        };

        document.addEventListener('keydown', onKey);

        return () => document.removeEventListener('keydown', onKey);
    }, [button, onOpen]);

    return (
        <div ref={wrapper} className="relative ml-auto flex max-w-[26rem] min-w-0 flex-1 justify-end">
            <div
                ref={ghost}
                aria-hidden="true"
                className="invisible absolute right-0 flex h-0 w-max gap-1 overflow-hidden"
            >
                {tokens.map((token) => (
                    <FieldToken key={token.id} token={token} />
                ))}
            </div>
            <button
                ref={button}
                type="button"
                tabIndex={0}
                data-search-field
                data-folded={folded || undefined}
                aria-haspopup="dialog"
                aria-keyshortcuts={MAC ? 'Meta+K' : 'Control+K'}
                aria-label={`Search${tokens.length ? `, filtered by ${tokens.map(({ label }) => label).join(', ')}` : ''}`}
                onClick={onOpen}
                style={folded ? undefined : { width }}
                className={`text-base-700 focus-visible:outline-primary relative flex h-7 shrink-0 cursor-pointer items-center rounded-lg text-xs transition-colors focus-visible:outline-2 ${
                    folded
                        ? 'hover:bg-base-200 hover:text-base-content dark:hover:bg-base-300 w-7 justify-center'
                        : 'border-base-300 bg-base-100 hover:border-base-400 dark:bg-base-200 gap-1 border pr-2 pl-1.5'
                }`}
            >
                <Search aria-hidden="true" className={`shrink-0 ${folded ? 'size-4' : 'mr-0.5 size-3.5'}`} />
                {folded ? (
                    tokens.length > 0 && (
                        <span
                            data-search-count
                            className="bg-primary text-2xs text-primary-content absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full px-0.5 leading-none font-semibold tabular-nums"
                        >
                            {tokens.length}
                        </span>
                    )
                ) : (
                    <>
                        {tokens.slice(0, shown).map((token) => (
                            <FieldToken key={token.id} token={token} />
                        ))}
                        {hidden.length > 0 && (
                            <span
                                data-search-count
                                title={hidden.map(({ label }) => label).join(', ')}
                                className={`${PILL} tabular-nums`}
                            >
                                {shown > 0 ? '+' : ''}
                                {hidden.length}
                            </span>
                        )}
                        <span className="ml-0.5 min-w-0 flex-1 truncate text-left">Search</span>
                        {keyHint && (
                            <span className="shrink-0 pointer-coarse:hidden">
                                <Key>{MAC ? '⌘K' : 'Ctrl K'}</Key>
                            </span>
                        )}
                    </>
                )}
            </button>
        </div>
    );
}
