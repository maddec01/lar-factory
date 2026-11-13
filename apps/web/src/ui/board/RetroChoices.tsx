import type { Retro } from '@lar-factory/shared';
import { Alert, Button, Checkbox, Inline, Stack, Text } from '@lar-works/design-system';

import { buttonKind } from './ButtonKinds';

/** The complete retro list and its choice stay together in item details. */
export function RetroChoices({
    retro,
    selected,
    pending,
    error,
    onToggle,
    onChoose,
    onRetry,
}: {
    retro: Retro;
    selected: number[];
    pending: boolean;
    error: string | null;
    onToggle: (index: number) => void;
    onChoose: (selected: number[]) => void;
    onRetry: () => void;
}) {
    return (
        <Stack space="tight" onClick={(event) => event.stopPropagation()}>
            {retro.suggestions?.map((suggestion, index) => (
                <Stack space="tight" key={index}>
                    <label className="flex items-start gap-2 text-sm">
                        {!retro.choice && (
                            <Checkbox
                                checked={selected.includes(index)}
                                disabled={pending}
                                onChange={() => onToggle(index)}
                            />
                        )}
                        <span className="min-w-0 font-medium break-words">{suggestion.title}</span>
                    </label>
                    <Text variant="caption" breaks>
                        {suggestion.description}
                    </Text>
                    <Text variant="caption" tone="muted" breaks>
                        {suggestion.repository}
                    </Text>
                    {retro.captures[index]?.error && <Alert tone="danger">{retro.captures[index]?.error}</Alert>}
                </Stack>
            ))}
            {(error || retro.delivery.error) && <Alert tone="danger">{error || retro.delivery.error}</Alert>}
            <Inline wrap>
                {retro.suggestions?.length && !retro.choice ? (
                    <>
                        <Button
                            {...buttonKind('next')}
                            disabled={pending || !selected.length}
                            onClick={() => onChoose(selected)}
                        >
                            Create chosen follow-ups
                        </Button>
                        <Button {...buttonKind('other')} disabled={pending} onClick={() => onChoose([])}>
                            No follow-ups
                        </Button>
                    </>
                ) : (
                    <Button {...buttonKind('next')} disabled={pending} onClick={onRetry}>
                        Retry retro
                    </Button>
                )}
            </Inline>
        </Stack>
    );
}
