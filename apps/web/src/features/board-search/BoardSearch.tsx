// The board search: a field in the title bar that looks like lar-server's CommandPaletteTrigger, and the dialog it opens,
// by a click or ⌘K (Ctrl K off Apple platforms). Tokens in the closed field only say what the board is filtered by. The
// field measures its own room and folds to fit (FieldFit.ts). In the dialog, choosing a filter keeps it open, and any
// other choice closes it first, so a dialog that opens next returns the focus to the field.

import { boardApp } from '@lar-factory/shared';
import { SearchDialog, SearchDialogGroup, useSearchDialogOption } from '@lar-factory/ui/search-dialog';
import { Button } from '@lar-works/design-system';
import { Check } from '@lar-works/design-system/icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { useFilterGroups, useFilterTokens } from './BoardFilters';
import type { FilterToken } from './BoardFilters';
import { Field, Key } from './SearchField';
import type { SearchOption } from './SearchOptions';
import { searchResults, settingsOptions } from './SearchResults';
import { useScopeStore, useShownScope } from '@/features/filters';
import { resolveUpdateButtonAction, useUpdateStore } from '@/features/updates';
import { useBoardStore } from '@/services/board/board.hooks';
import { useInstallStore } from '@/services/install/install.hooks';
import { kind } from '@/shared/ui/buttons/ButtonKinds';
import { Loader } from '@/shared/ui/loading/Loader';

function OptionRow({ option }: { option: SearchOption }) {
    const props = useSearchDialogOption(option.value);

    return (
        <div
            {...props}
            aria-checked={option.on}
            className="text-base-800 aria-selected:bg-primary/10 aria-selected:ring-primary/30 dark:text-base-content flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm aria-selected:ring-1 aria-selected:ring-inset pointer-coarse:h-11"
        >
            <span className="text-base-700 grid size-4 shrink-0 place-items-center">{option.icon}</span>
            <span title={option.name} className="min-w-0 flex-1 truncate">
                {option.name}
            </span>
            {option.hint && (
                <span className="text-base-700 max-w-40 shrink-0 truncate text-xs tabular-nums">{option.hint}</span>
            )}
            {option.meta && (
                <span className="text-base-700 max-w-56 shrink-0 truncate text-xs max-sm:hidden">{option.meta}</span>
            )}
            {option.on && <Check aria-hidden="true" className="text-primary size-3.5 shrink-0" />}
        </div>
    );
}

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
        <SearchDialog
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
                    <Button {...kind('other')} data-search-clear className="pointer-coarse:h-11!" onClick={clear}>
                        Clear
                    </Button>
                )
            }
            options={options.map(({ value }) => value)}
            onSelect={(value) => options.find((option) => option.value === value)?.select()}
            onClose={onClose}
            listLabel="Search results"
            empty="Nothing matches."
            busy={reading ? <Loader label="Loading Projects…" /> : undefined}
            footer={
                <>
                    <span>
                        <Key>↑↓</Key> move
                    </span>
                    <span>
                        <Key>↵</Key> choose
                    </span>
                    {tokens.length > 0 && (
                        <span>
                            <Key>⌫</Key> remove filter
                        </span>
                    )}
                    <span>
                        <Key>esc</Key> close
                    </span>
                </>
            }
        >
            {groups.map((group) => (
                <SearchDialogGroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                        <OptionRow key={option.value} option={option} />
                    ))}
                </SearchDialogGroup>
            ))}
        </SearchDialog>
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
            <Field button={button} tokens={tokens} onOpen={show} />
            {open && <Dialog tokens={tokens} clear={clear} leave={leave} onClose={() => setOpen(false)} />}
        </>
    );
}
