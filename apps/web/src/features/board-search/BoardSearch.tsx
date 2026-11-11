// The board search: a field in the title bar that looks like lar-server's CommandPaletteTrigger, and the dialog it opens,
// by a click or ⌘K (Ctrl K off Apple platforms). Tokens in the closed field only say what the board is filtered by. The
// field measures its own room and folds to fit (FieldFit.ts). In the dialog, choosing a filter keeps it open, and any
// other choice closes it first, so a dialog that opens next returns the focus to the field.

import { boardApp } from '@lar-factory/shared';
import {
    Button,
    EmptyState,
    CommandPalette,
    CommandPaletteGroup,
    CommandPaletteOption,
    CommandPaletteTrigger,
    Loading,
} from '@lar-works/design-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import type { FilterToken } from './BoardFilters';
import { searchResults, settingsOptions } from './SearchResults';
import { useFilterGroups, useFilterTokens } from './useFilterTokens';
import { useScopeStore, useShownScope } from '@/features/filters';
import { resolveUpdateButtonAction, useUpdateStore } from '@/features/updates';
import { useBoardStore } from '@/services/board/board.hooks';
import { useInstallStore } from '@/services/install/install.hooks';
import { buttonKind } from '@/ui/board';

/** The step the Update pill would run now; none while it does nothing, as when another step is under way. */
function useUpdateStep() {
    return useUpdateStore(({ state, installing, pending, confirming }) =>
        !boardApp() || !state || installing || pending || confirming ? 'none' : resolveUpdateButtonAction(state),
    );
}

function Dialog({
    tokens,
    clear,
    leave,
    onClose,
}: {
    tokens: FilterToken[];
    clear: () => void;
    leave: (run: () => void) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState('');
    // Whether Search all tickets was chosen for this query.
    const [widened, setWidened] = useState(false);
    const data = useBoardStore((state) => state.data);
    const now = useBoardStore((state) => state.now);
    const app = !!boardApp();
    const targets = useInstallStore((state) => state.snapshot?.targets ?? null);
    const version = useUpdateStore((state) => state.state?.currentVersion ?? null);
    const settingOptions = useMemo(
        () => settingsOptions(data, { app, targets, version }, leave),
        [data, app, targets, version, leave],
    );
    const { groups, reading } = searchResults(
        {
            data,
            now,
            query,
            scope: useShownScope(),
            filters: useScopeStore((state) => state.filters),
            widened,
            filterGroups: useFilterGroups(),
            filtering: tokens.length > 0,
            update: useUpdateStep(),
            settingOptions,
        },
        { leave, clear, widen: () => setWidened(true) },
    );
    const options = groups.flatMap((group) => group.options);

    return (
        <CommandPalette
            label="Search the board"
            description="Find tickets, actions and settings, and filter the board."
            placeholder="Search"
            query={query}
            onQueryChange={(next) => {
                setQuery(next);
                setWidened(false);
            }}
            tokens={tokens}
            onBackspaceEmpty={() => tokens.at(-1)?.remove?.onRemove()}
            trailing={
                tokens.length > 0 && (
                    <Button {...buttonKind('other')} data-search-clear onClick={clear}>
                        Clear
                    </Button>
                )
            }
            options={options.map(({ value }) => value)}
            onSelect={(value) => options.find((option) => option.value === value)?.select()}
            onClose={onClose}
            listLabel="Search results"
            empty={
                <EmptyState
                    size="compact"
                    title="Nothing matches"
                    actions={
                        <Button
                            variant="secondary"
                            onClick={() => {
                                setQuery('');
                                setWidened(false);
                            }}
                        >
                            Clear search
                        </Button>
                    }
                />
            }
            busy={reading}
            busyLabel={<Loading presentation="inline" label="Loading projects…" />}
        >
            {groups.map((group) => (
                <CommandPaletteGroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                        <CommandPaletteOption
                            key={option.value}
                            value={option.value}
                            icon={option.icon}
                            name={option.name}
                            {...(option.hint !== undefined && { hint: option.hint })}
                            {...(option.meta !== undefined && { meta: option.meta })}
                            {...(option.on !== undefined && { checked: option.on })}
                        />
                    ))}
                </CommandPaletteGroup>
            ))}
        </CommandPalette>
    );
}

export function BoardSearch() {
    const [open, setOpen] = useState(false);
    const { tokens, clear } = useFilterTokens();
    const button = useRef<HTMLButtonElement>(null);
    const show = useCallback(() => setOpen(true), []);
    const restartFromSearch = useRef(false);
    const focusFrame = useRef<number | undefined>(undefined);

    useEffect(() => {
        const stop = useUpdateStore.subscribe((state, before) => {
            if (!before.confirming || state.confirming || !restartFromSearch.current) return;

            restartFromSearch.current = false;
            // Wait until the dialog releases the board's inert state and finishes its focus return.
            focusFrame.current = requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
        });

        return () => {
            stop();

            if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
        };
    }, []);

    // The dialog goes first and the field takes the focus, so a dialog `run` opens has somewhere to return it.
    const leave = useCallback((run: () => void) => {
        flushSync(() => setOpen(false));
        button.current?.focus({ preventScroll: true });
        run();
        restartFromSearch.current = useUpdateStore.getState().confirming;
    }, []);

    return (
        <>
            <CommandPaletteTrigger
                ref={button}
                label="Search"
                shortcut="k"
                tokens={tokens}
                filterLabel={(labels) => `filtered by ${labels.join(', ')}`}
                onOpen={show}
            />
            {open && <Dialog tokens={tokens} clear={clear} leave={leave} onClose={() => setOpen(false)} />}
        </>
    );
}
