// The board search: a field in the title bar that looks like lar-server's CommandPaletteTrigger, and the dialog it opens,
// by a click or ⌘K (Ctrl K off Apple platforms). Tokens in the closed field only say what the board is filtered by. The
// field measures its own room and folds to fit (FieldFit.ts). In the dialog, choosing a filter keeps it open, and any
// other choice closes it first, so a dialog that opens next returns the focus to the field.

import { boardApp } from '@lar-factory/shared';
import {
    Button,
    buttonKind,
    CommandPalette,
    CommandPaletteGroup,
    CommandPaletteOption,
    CommandPaletteTrigger,
    Kbd,
    Loading,
} from '@lar-works/design-system';
import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { useFilterGroups, useFilterTokens } from './BoardFilters';
import type { FilterToken } from './BoardFilters';
import { searchResults, settingsOptions } from './SearchResults';
import { useScopeStore, useShownScope } from '@/features/filters';
import { resolveUpdateButtonAction, useUpdateStore } from '@/features/updates';
import { useBoardStore } from '@/services/board/board.hooks';
import { useInstallStore } from '@/services/install/install.hooks';

/** The step the Update pill would run now; none while it does nothing, as when another step is under way. */
function useUpdateStep() {
    return useUpdateStore(({ state, installing, pending }) =>
        !boardApp() || !state || installing || pending ? 'none' : resolveUpdateButtonAction(state),
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
            empty="Nothing matches."
            busy={reading}
            busyLabel={<Loading presentation="inline" label="Loading Projects…"  />}
            footer={
                <>
                    <span>
                        <Kbd>↑↓</Kbd> move
                    </span>
                    <span>
                        <Kbd>↵</Kbd> choose
                    </span>
                    {tokens.length > 0 && (
                        <span>
                            <Kbd>⌫</Kbd> remove filter
                        </span>
                    )}
                    <span>
                        <Kbd>esc</Kbd> close
                    </span>
                </>
            }
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
    // The dialog goes first and the field takes the focus, so a dialog `run` opens has somewhere to return it.
    const leave = useCallback((run: () => void) => {
        flushSync(() => setOpen(false));
        button.current?.focus({ preventScroll: true });
        run();
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
