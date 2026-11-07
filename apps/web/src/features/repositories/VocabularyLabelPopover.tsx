// One kind's label chooser: a searchable list of the tracker's labels, with Create for a name typed that has none.

import type { VocabularyTerm } from '@lar-factory/shared';
import { emptyVocabularyTerm } from '@lar-factory/shared/vocabulary';
import {
    Button,
    buttonKind,
    Input,
    LabelChooser,
    LabelChooserEmpty,
    LabelChooserFooter,
    LabelChooserList,
    LabelChooserOption,
    Popover,
} from '@lar-works/design-system';

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
                <Button {...buttonKind('control')} disabled={disabled} aria-label={`Choose ${title} ${plural}`}>
                    {chosen.length ? 'Edit' : `Add ${noun}`}
                </Button>
            </Popover.Trigger>
            <Popover.Content align="end" width="md" {...labelPopoverPosition}>
                <LabelChooser data-label-picker={name}>
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
                    <LabelChooserList id={`labels-${name}`} label={`${title} ${plural}`}>
                        {matches.map((label, index) => (
                            <LabelChooserOption
                                key={label}
                                id={`label-${name}-${index}`}
                                selected={chosen.includes(label)}
                                disabled={!!labelsProblem && !chosen.includes(label)}
                                active={index === at}
                                onHover={() => setActive(index)}
                                onPick={() => choose(label)}
                            >
                                {chosen.includes(label) ? '✓ ' : ''}
                                {label}
                                {gone(label) ? ' (unavailable)' : ''}
                            </LabelChooserOption>
                        ))}
                        {!matches.length && (
                            <LabelChooserEmpty>
                                {typed ? `No ${plural} match "${typed}".` : `This Project has no ${plural} yet.`}
                            </LabelChooserEmpty>
                        )}
                    </LabelChooserList>
                    {canCreate && (
                        <Button
                            {...buttonKind('other')}
                            wrap
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
                    <LabelChooserFooter>
                        <Button {...buttonKind('other')} onClick={() => update(emptyVocabularyTerm(), [])}>
                            None
                        </Button>
                        <Button {...buttonKind('other')} onClick={() => close(false)}>
                            Done
                        </Button>
                    </LabelChooserFooter>
                </LabelChooser>
            </Popover.Content>
        </Popover>
    );
}
