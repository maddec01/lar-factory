import type { Retro } from '@lar-factory/shared';
import { Button, Checkbox, Inline, Stack } from '@lar-works/design-system';
import { FolderGit2Icon } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { buttonKind } from './ButtonKinds';

/** The complete retro list and its pick stay together in item details until the pick is made. */
export function RetroChoices({
    retro,
    selected,
    pending,
    onToggle,
    onChoose,
}: {
    retro: Retro;
    selected: number[];
    pending: boolean;
    onToggle: (index: number) => void;
    onChoose: (selected: number[]) => void;
}) {
    // While a pick saves, the button that made it spins.
    const [none, setNone] = useState(false);
    const choose = (choice: number[]) => {
        setNone(!choice.length);
        onChoose(choice);
    };

    return (
        <Stack space="related" onClick={(event) => event.stopPropagation()}>
            <ul className="grid gap-2">
                {retro.suggestions?.map((suggestion, index) => (
                    <li key={index}>
                        <label className="border-line hover:bg-fill-hover has-checked:border-primary grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 text-sm has-disabled:cursor-default">
                            <span className="grid h-5 place-items-center">
                                <Checkbox
                                    checked={selected.includes(index)}
                                    disabled={pending}
                                    onChange={() => onToggle(index)}
                                />
                            </span>
                            <span className="text-fg min-w-0 leading-5 font-medium break-words">
                                {suggestion.title}
                            </span>
                            <span className="text-fg-muted col-start-2 min-w-0 text-xs leading-5 break-words whitespace-pre-line">
                                {suggestion.description}
                            </span>
                            <span className="text-fg-muted col-start-2 flex min-w-0 items-center gap-1.5 pt-0.5 text-xs">
                                <FolderGit2Icon aria-hidden className="size-3.5 shrink-0" />
                                <span className="min-w-0 truncate">{suggestion.repository}</span>
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
            <div className="pt-1">
                <Inline wrap>
                    <Button
                        {...buttonKind('next')}
                        busy={pending && !none}
                        disabled={pending || !selected.length}
                        onClick={() => choose(selected)}
                    >
                        Create chosen follow-ups
                    </Button>
                    <Button
                        {...buttonKind('other')}
                        busy={pending && none}
                        disabled={pending}
                        onClick={() => choose([])}
                    >
                        No follow-ups
                    </Button>
                </Inline>
            </div>
        </Stack>
    );
}
