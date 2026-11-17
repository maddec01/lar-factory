import type { Retro } from '@lar-factory/shared';
import { Button, Checkbox, Inline, Stack, Text } from '@lar-works/design-system';
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
        <Stack space="tight" onClick={(event) => event.stopPropagation()}>
            {retro.suggestions?.map((suggestion, index) => (
                <Stack space="tight" key={index}>
                    <label className="flex items-start gap-2 text-sm">
                        <Checkbox
                            checked={selected.includes(index)}
                            disabled={pending}
                            onChange={() => onToggle(index)}
                        />
                        <span className="min-w-0 font-medium break-words">{suggestion.title}</span>
                    </label>
                    <Text variant="caption" breaks>
                        {suggestion.description}
                    </Text>
                    <Text variant="caption" tone="muted" breaks>
                        {suggestion.repository}
                    </Text>
                </Stack>
            ))}
            <Inline wrap>
                <Button
                    {...buttonKind('next')}
                    busy={pending && !none}
                    disabled={pending || !selected.length}
                    onClick={() => choose(selected)}
                >
                    Create chosen follow-ups
                </Button>
                <Button {...buttonKind('other')} busy={pending && none} disabled={pending} onClick={() => choose([])}>
                    No follow-ups
                </Button>
            </Inline>
        </Stack>
    );
}
