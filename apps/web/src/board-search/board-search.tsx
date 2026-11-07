// The board search: a field in the title bar that looks like lar-server's CommandPaletteTrigger, and the dialog it opens,
// by a click or ⌘K (Ctrl K off Apple platforms). Tokens in the closed field only say what the board is filtered by. The
// field measures its own room and folds to fit (field-fit.ts). In the dialog, choosing a filter keeps it open, and any
// other choice closes it first, so a dialog that opens next returns the focus to the field.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Check, Search } from '@lar-works/design-system/icons';
import { boardApp } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { SearchDialog, SearchDialogGroup, useSearchDialogOption } from '@lar-factory/ui/search-dialog';
import { useBoardStore } from '../board/board-store.ts';
import { useScopeStore, useShownScope } from '../board/scope-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { MAC } from '../expand-dialog/expand-dialog.tsx';
import { Loader } from '../loading/loader.tsx';
import { useInstallStore } from '../settings/install-store.ts';
import { resolveUpdateButtonAction } from '../updates/update-button-logic.ts';
import { useUpdateStore } from '../updates/update-store.ts';
import { useFilterGroups, useFilterTokens } from './board-filters.tsx';
import type { FilterToken } from './board-filters.tsx';
import { fitField } from './field-fit.ts';
import type { SearchOption } from './search-options.ts';
import { searchResults, settingsOptions } from './search-results.tsx';

const Key = ({ children }: { children: ReactNode }) => <kbd className="font-sans text-2xs font-medium text-base-700">{children}</kbd>;

const PILL = 'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-base-200 px-1 text-2xs font-medium text-base-800 dark:bg-base-300 dark:text-base-content [&_svg]:size-3';

function FieldToken({ token }: { token: FilterToken }) {
  const hued = token.hue !== undefined;
  return (
    <span title={token.label} className={`${PILL} ${hued ? 'kind-badge!' : ''}`} style={hued ? ({ '--lar-kind-hue': token.hue } as CSSProperties) : undefined}>
      {token.leading}
      <span className="max-w-32 min-w-0 truncate">{token.label}</span>
    </span>
  );
}

/** The room in `wrapper` and the title bar, and each child's width in `ghost`, which draws every token out of sight to be measured. */
function useFieldRoom(wrapper: RefObject<HTMLElement | null>, ghost: RefObject<HTMLElement | null>, tokens: string) {
  const [room, setRoom] = useState({ field: 0, bar: 0 });
  const [widths, setWidths] = useState<number[]>([]);
  useLayoutEffect(() => {
    const measure = () => {
      setRoom({ field: wrapper.current!.getBoundingClientRect().width, bar: wrapper.current!.closest('header')!.getBoundingClientRect().width });
      const next = [...ghost.current!.children].map((child) => (child as HTMLElement).offsetWidth);
      setWidths((now) => (now.join() === next.join() ? now : next));
    };
    measure();
    // The ghost resizes too when a late web font changes the tokens' widths.
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper.current!);
    observer.observe(ghost.current!);
    return () => observer.disconnect();
  }, [wrapper, ghost, tokens]);
  return { room, widths };
}

function Field({ button, tokens, onOpen }: { button: RefObject<HTMLButtonElement | null>; tokens: FilterToken[]; onOpen: () => void }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const { room, widths } = useFieldRoom(wrapper, ghost, tokens.map(({ id }) => id).join());
  const { shown, keyHint, folded, width } = fitField(room, widths);
  const hidden = tokens.slice(shown);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey || !(MAC ? event.metaKey : event.ctrlKey)) return;
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
      <div ref={ghost} aria-hidden="true" className="invisible absolute right-0 flex h-0 w-max gap-1 overflow-hidden">
        {tokens.map((token) => <FieldToken key={token.id} token={token} />)}
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
        className={`relative flex h-7 shrink-0 cursor-pointer items-center rounded-lg text-xs text-base-700 transition-colors focus-visible:outline-2 focus-visible:outline-primary ${folded
          ? 'w-7 justify-center hover:bg-base-200 hover:text-base-content dark:hover:bg-base-300'
          : 'gap-1 border border-base-300 bg-base-100 pr-2 pl-1.5 hover:border-base-400 dark:bg-base-200'}`}
      >
        <Search aria-hidden="true" className={`shrink-0 ${folded ? 'size-4' : 'mr-0.5 size-3.5'}`} />
        {folded ? (
          tokens.length > 0 && <span data-search-count className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-2xs leading-none font-semibold text-primary-content tabular-nums">{tokens.length}</span>
        ) : (
          <>
            {tokens.slice(0, shown).map((token) => <FieldToken key={token.id} token={token} />)}
            {hidden.length > 0 && <span data-search-count title={hidden.map(({ label }) => label).join(', ')} className={`${PILL} tabular-nums`}>{shown > 0 ? '+' : ''}{hidden.length}</span>}
            <span className="ml-0.5 min-w-0 flex-1 truncate text-left">Search</span>
            {keyHint && <span className="shrink-0 pointer-coarse:hidden"><Key>{MAC ? '⌘K' : 'Ctrl K'}</Key></span>}
          </>
        )}
      </button>
    </div>
  );
}

function OptionRow({ option }: { option: SearchOption }) {
  const props = useSearchDialogOption(option.value);
  return (
    <div {...props} aria-checked={option.on} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-base-800 aria-selected:bg-primary/10 aria-selected:ring-1 aria-selected:ring-primary/30 aria-selected:ring-inset pointer-coarse:h-11 dark:text-base-content">
      <span className="grid size-4 shrink-0 place-items-center text-base-700">{option.icon}</span>
      <span title={option.name} className="min-w-0 flex-1 truncate">{option.name}</span>
      {option.hint && <span className="max-w-40 shrink-0 truncate text-xs text-base-700 tabular-nums">{option.hint}</span>}
      {option.meta && <span className="max-w-56 shrink-0 truncate text-xs text-base-700 max-sm:hidden">{option.meta}</span>}
      {option.on && <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" />}
    </div>
  );
}

/** The step the Update pill would run now; none while it does nothing, as when another step is under way. */
function useUpdateStep() {
  return useUpdateStore(({ state, installing, pending }) => (!boardApp() || !state || installing || pending ? 'none' : resolveUpdateButtonAction(state)));
}

function Dialog({ tokens, clear, leave, onClose }: { tokens: FilterToken[]; clear: () => void; leave: (run: () => void) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  // Whether Search all tickets was chosen for this query.
  const [widened, setWidened] = useState(false);
  const data = useBoardStore((state) => state.data);
  const now = useBoardStore((state) => state.now);
  const app = !!boardApp();
  const targets = useInstallStore((state) => state.snapshot?.targets ?? null);
  const version = useUpdateStore((state) => state.state?.currentVersion ?? null);
  const settingOptions = useMemo(() => settingsOptions(data, { app, targets, version }, leave), [data, app, targets, version, leave]);
  const { groups, reading } = searchResults({
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
  }, { leave, clear, widen: () => setWidened(true) });
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
      trailing={tokens.length > 0 && <Button {...kind('other')} data-search-clear className="pointer-coarse:h-11!" onClick={clear}>Clear</Button>}
      options={options.map(({ value }) => value)}
      onSelect={(value) => options.find((option) => option.value === value)?.select()}
      onClose={onClose}
      listLabel="Search results"
      empty="Nothing matches."
      busy={reading ? <Loader label="Loading Projects…" /> : undefined}
      footer={<>
        <span><Key>↑↓</Key> move</span>
        <span><Key>↵</Key> choose</span>
        {tokens.length > 0 && <span><Key>⌫</Key> remove filter</span>}
        <span><Key>esc</Key> close</span>
      </>}
    >
      {groups.map((group) => (
        <SearchDialogGroup key={group.label} label={group.label}>
          {group.options.map((option) => <OptionRow key={option.value} option={option} />)}
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
  return <>
    <Field button={button} tokens={tokens} onOpen={show} />
    {open && <Dialog tokens={tokens} clear={clear} leave={leave} onClose={() => setOpen(false)} />}
  </>;
}
