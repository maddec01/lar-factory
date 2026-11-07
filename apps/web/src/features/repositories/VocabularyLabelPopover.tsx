// One kind's label chooser: a searchable list of the tracker's labels, with Create for a name typed that has none.

import type { VocabularyTerm } from '@lar-factory/shared';
import { emptyVocabularyTerm } from '@lar-factory/shared/vocabulary';
import { Button, buttonKind, Input, Popover } from '@lar-works/design-system';

import { AccessReason } from './AccessList';
import type { useVocabularyFields } from './useVocabularyFields';
import type { VocabularyKind } from './VocabularyKinds';

// Ninna forwards Radix collision padding, though its public prop type omits it.
const labelPopoverPosition = { collisionPadding: 16 };

export function VocabularyLabelPopover({
    name,
    repo,
    value,
    newLabels,
    disabled,
    onCommit,
    onRecheck,
    fields: {
        open,
        close,
        title,
        plural,
        noun,
        chosen,
        labels,
        matches,
        at,
        query,
        setQuery,
        setActive,
        choose,
        labelsProblem,
        gone,
        canCreate,
        createProblem,
        typed,
        update,
    },
}: {
    name: VocabularyKind;
    repo: string;
    value: VocabularyTerm;
    newLabels: string[];
    disabled: boolean;
    onCommit?: ((value: VocabularyTerm, newLabels: string[]) => void) | undefined;
    onRecheck?: (() => void) | undefined;
    fields: ReturnType<typeof useVocabularyFields>;
}) {
    return (
        <Popover open={open} onOpenChange={close}>
            <Popover.Trigger asChild>
                <Button
                    {...buttonKind('control')}
                    disabled={disabled}
                    className="ms-auto"
                    aria-label={`Choose ${title} ${plural}`}
                >
                    {chosen.length ? 'Edit' : `Add ${noun}`}
                </Button>
            </Popover.Trigger>
            <Popover.Content align="end" data-kind-label-popover {...labelPopoverPosition}>
                <div className="grid w-full min-w-0 gap-2" data-label-picker={name}>
                    <Input
                        autoFocus
                        type="search"
                        role="combobox"
                        aria-expanded
                        aria-controls={`labels-${name}`}
                        aria-activedescendant={matches[at] ? `label-${name}-${at}` : undefined}
                        aria-label={`Search ${plural} for ${title}`}
                        placeholder={`Search ${labels.length} ${plural}`}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActive(0);
                        }}
                        onKeyDown={(event) => {
                            if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key))
                                event.preventDefault();

                            if (event.key === 'ArrowDown') setActive(Math.min(at + 1, matches.length - 1));

                            if (event.key === 'ArrowUp') setActive(Math.max(at - 1, 0));

                            if (event.key === 'Home') setActive(0);

                            if (event.key === 'End') setActive(matches.length - 1);

                            if (event.key === 'Enter') choose(matches[at]);
                        }}
                    />
                    <ul
                        id={`labels-${name}`}
                        role="listbox"
                        aria-multiselectable
                        aria-label={`${title} ${plural}`}
                        className="m-0 h-64 list-none overflow-y-auto overscroll-contain p-0"
                        onWheel={(event) => event.stopPropagation()}
                    >
                        {matches.map((label, index) => (
                            <li
                                key={label}
                                id={`label-${name}-${index}`}
                                role="option"
                                aria-selected={chosen.includes(label)}
                                aria-disabled={!!labelsProblem && !chosen.includes(label)}
                                className={`cursor-pointer rounded px-2 py-1 text-[13px] wrap-anywhere ${index === at ? 'bg-(--muted)' : ''}`}
                                onMouseMove={() => setActive(index)}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => choose(label)}
                            >
                                {chosen.includes(label) ? '✓ ' : ''}
                                {label}
                                {gone(label) ? ' (unavailable)' : ''}
                            </li>
                        ))}
                        {!matches.length && (
                            <li role="status" className="px-2 py-2 text-xs text-(--muted-foreground)">
                                {typed ? `No ${plural} match "${typed}".` : `This Project has no ${plural} yet.`}
                            </li>
                        )}
                    </ul>
                    {canCreate && (
                        <Button
                            {...buttonKind('other')}
                            className="h-auto min-h-8 max-w-full min-w-0 py-1 text-left wrap-anywhere whitespace-normal"
                            disabled={!!createProblem || disabled}
                            onClick={() => {
                                if (createProblem) return;

                                update(value, [...newLabels, typed], !!onCommit);

                                if (!onCommit) setQuery('');
                            }}
                        >
                            {onCommit ? `Create "${typed}"` : `Create "${typed}" when you add the Project`}
                        </Button>
                    )}
                    {canCreate && createProblem && (
                        <AccessReason repo={repo} reason={createProblem} onRecheck={onRecheck} />
                    )}
                    <div className="flex justify-between gap-2 border-t border-(--border) pt-2">
                        <Button {...buttonKind('other')} onClick={() => update(emptyVocabularyTerm(), [])}>
                            None
                        </Button>
                        <Button {...buttonKind('other')} onClick={() => close(false)}>
                            Done
                        </Button>
                    </div>
                </div>
            </Popover.Content>
        </Popover>
    );
}
