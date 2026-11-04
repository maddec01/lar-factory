// The board search's dialog: a field with its tokens over one keyboard list of grouped options, near the top of the
// page or, on phones, the whole screen. lar-server's CommandPalette has the same look and keys but only one scope chip,
// and the copied Modal always renders a heading, so this sits directly on ninna-ui. It knows nothing of the board.
import { Modal } from '@ninna-ui/overlays';
import { createContext, type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '../design-system/actions/IconButton.tsx';
import { useDesignSystemLabels } from '../design-system/foundations/DesignSystemProvider.tsx';
import { CloseIcon, SearchIcon } from '../design-system/icons/NavigationIcons.tsx';
import { useModalAutoFocus } from '../design-system/overlays/useModalAutoFocus.ts';
import { useScrollFade } from '../design-system/overlays/useScrollFade.ts';
import { Text } from '../design-system/typography/Typography.tsx';

export interface SearchDialogToken {
  id: string;
  label: string;
  /** An icon or colour mark before the label. */
  leading?: ReactNode;
  remove?: { label: string; onRemove: () => void };
}

export interface SearchDialogProps {
  /** The dialog's accessible title and description; the field says the rest. */
  label: string;
  description: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  tokens?: readonly SearchDialogToken[];
  onBackspaceEmpty?: () => void;
  /** A control beside the tokens. A press on it leaves the focus in the field, as it may take itself away. */
  trailing?: ReactNode;
  /** The options' values in list order, for the arrow keys and Enter. */
  options: readonly string[];
  onSelect: (value: string) => void;
  onClose: () => void;
  listLabel: string;
  /** Shown when nothing is listed and nothing is pending. */
  empty?: ReactNode;
  /** Shown under the list while more may arrive, and marks the list busy. */
  busy?: ReactNode;
  /** Quiet key hints under the list, on screens with a fine pointer. */
  footer?: ReactNode;
  children: ReactNode;
}

const OptionContext = createContext<{
  listId: string;
  activeValue: string | undefined;
  setActiveValue: (value: string) => void;
  onSelect: (value: string) => void;
} | null>(null);

export function SearchDialog({ label, description, placeholder, query, onQueryChange, tokens = [], onBackspaceEmpty, trailing, options, onSelect, onClose, listLabel, empty, busy, footer, children }: SearchDialogProps) {
  const labels = useDesignSystemLabels();
  const focusProps = useModalAutoFocus();
  const { setViewport, setContent, className } = useScrollFade();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setActiveValue] = useState<string>();
  // The highlight follows the list: when the chosen option leaves it, the first option takes over.
  const activeValue = chosen !== undefined && options.includes(chosen) ? chosen : options[0];

  useEffect(() => {
    if (activeValue !== undefined) document.getElementById(optionId(listId, activeValue))?.scrollIntoView({ block: 'nearest' });
  }, [activeValue, listId]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content
        title={label}
        description={description}
        centered={false}
        {...focusProps}
        // The dialog listens for Esc on the document, past the field's own key handling.
        onEscapeKeyDown={(event) => { if (event.isComposing) event.preventDefault(); }}
        data-search-dialog=""
        className="flex max-h-[min(36rem,calc(100dvh-6rem))] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0 sm:w-[calc(100vw-2rem)] sm:max-w-2xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex shrink-0 items-start gap-2 border-b border-base-300 px-4 py-2">
          <span className="flex h-8 shrink-0 items-center text-base-600 [&>svg]:size-4"><SearchIcon /></span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            {tokens.length > 0 && (
              // The tokens scroll on their own, so the field stays in view however many there are. Under a coarse pointer each
              // remove button is 44 px, reaching past its token's height into the gap between rows.
              <ul className="flex max-h-19 max-w-full min-w-0 flex-wrap items-center gap-1 overflow-y-auto overscroll-contain py-1 pointer-coarse:max-h-22 pointer-coarse:gap-y-3 pointer-coarse:py-1.5">
                {tokens.map((token) => (
                  <li key={token.id} className="flex max-w-full min-w-0 items-center gap-1 rounded-md bg-primary/12 py-0.5 pr-1 pl-2 text-xs font-medium text-primary pointer-coarse:min-h-8 pointer-coarse:py-0 pointer-coarse:pr-0 dark:text-base-content">
                    {token.leading && <span className="flex shrink-0 items-center">{token.leading}</span>}
                    <span className="min-w-0 truncate">{token.label}</span>
                    {token.remove && (
                      <button
                        type="button"
                        aria-label={token.remove.label}
                        className="grid shrink-0 place-items-center rounded-sm p-0.5 hover:bg-primary/15 pointer-coarse:-my-1.5 pointer-coarse:size-11 pointer-coarse:p-0 [&>svg]:size-3"
                        onClick={() => {
                          token.remove?.onRemove();
                          input.current?.focus();
                        }}
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={input}
              role="combobox"
              aria-label={label}
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeValue !== undefined ? optionId(listId, activeValue) : undefined}
              placeholder={placeholder}
              value={query}
              className="h-8 min-w-32 flex-1 bg-transparent text-base text-base-content outline-none placeholder:text-base-700 sm:text-sm"
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Backspace' && !query) {
                  event.preventDefault();
                  onBackspaceEmpty?.();
                } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
                  event.preventDefault();
                  const index = activeValue !== undefined ? options.indexOf(activeValue) : -1;
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setActiveValue(options[(index + step + options.length) % options.length]);
                } else if (event.key === 'Enter' && activeValue !== undefined) {
                  event.preventDefault();
                  onSelect(activeValue);
                }
              }}
            />
          </div>
          {trailing && <div className="flex min-h-8 shrink-0 items-center" onClick={() => input.current?.focus()}>{trailing}</div>}
          <span className="flex sm:hidden">
            <IconButton aria-label={labels.close} icon={<CloseIcon />} onClick={onClose} variant="header" className="pointer-coarse:size-11" />
          </span>
        </div>
        <div ref={setViewport} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 ${className}`}>
          <div ref={setContent} className="flow-root">
            <OptionContext.Provider value={{ listId, activeValue, setActiveValue, onSelect }}>
              <div id={listId} role="listbox" aria-label={listLabel} aria-busy={Boolean(busy)} className="flex flex-col gap-1">
                {children}
              </div>
            </OptionContext.Provider>
            <div role="status">
              {busy || (options.length === 0 && empty) ? (
                <Text as="div" tone="muted" className="px-3 py-8 text-center">{busy || empty}</Text>
              ) : null}
            </div>
          </div>
        </div>
        {footer && (
          <div className="hidden shrink-0 items-center gap-4 border-t border-base-300 px-4 py-2 text-2xs text-base-700 pointer-fine:flex">
            {footer}
          </div>
        )}
      </Modal.Content>
    </Modal>
  );
}

/** A labelled run of options in the dialog's list. */
export function SearchDialogGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1 not-first:pt-2">
      <Text as="span" id={labelId} variant="caption" tone="muted" className="px-2 pt-1 font-medium tracking-wide uppercase">{label}</Text>
      {children}
    </div>
  );
}

/** Props to spread on one option's element, which styles its highlight with `aria-selected`. A press leaves the focus
 *  in the field, since a filter's option keeps the dialog open. */
export function useSearchDialogOption(value: string) {
  const context = useContext(OptionContext);
  if (!context) throw new Error('useSearchDialogOption must be used inside SearchDialog');
  return {
    id: optionId(context.listId, value),
    role: 'option',
    'aria-selected': context.activeValue === value,
    tabIndex: -1,
    onPointerMove: () => {
      if (context.activeValue !== value) context.setActiveValue(value);
    },
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: () => context.onSelect(value),
  };
}

function optionId(listId: string, value: string) {
  return `${listId}-${encodeURIComponent(value)}`;
}
