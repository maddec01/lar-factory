// Settings › General: how many heavy commands, or builds, may run at once on this Mac. Automatic shows the number it
// gives here; a number is a whole number from 1, saved with its own button or Enter.

import type { HeavyCommandLimit, HeavyCommandLimitState } from '@lar-factory/shared';
import { Alert, Button, Inline, Input, Stack, Text } from '@lar-works/design-system';
import { useId, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { postAction, receive } from '@/services/board/board.service';
import { Choice } from '@/shared/settings/SettingControls';
import { buttonKind } from '@/ui/board';

function wholeFromOne(text: string): number | null {
    const n = Number(text);

    return text.trim() !== '' && Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * Automatic or a number. An invalid file uses the effective Automatic value; a missing server value is explicitly
 * Not reported, so the UI never invents a machine-specific limit.
 */
export function LimitSetting({
    name,
    label,
    field,
    state,
}: {
    /** The setting's id, which also names its endpoint: `heavy-command-limit` or `build-limit`. */
    name: string;
    label: string;
    /** The number field's accessible name. */
    field: string;
    state: HeavyCommandLimitState | undefined;
}) {
    const saved = state?.limit;
    const [mode, setMode] = useState<'automatic' | 'number' | null>(null);
    const [typed, setTyped] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hint = useId();
    const shown =
        mode ??
        (state?.problem ? 'automatic' : saved === undefined ? null : saved === 'automatic' ? 'automatic' : 'number');
    const text = typed ?? (typeof saved === 'number' ? String(saved) : '');
    const number = wholeFromOne(text);
    const invalid = text.trim() !== '' && number === null;
    // Busy or unchanged rather than disabled, so focus stays on the button just pressed.
    const held = saving || (number === saved && !state?.problem);

    const save = async (limit: HeavyCommandLimit) => {
        setSaving(true);
        setError(null);

        const result = await postAction(`/api/${name}`, { limit });

        flushSync(() => {
            receive(result);
            setSaving(false);
            setError(result.error);

            if (!result.error) {
                setMode(null);
                setTyped(null);
            }
        });
    };

    const submit = (event: FormEvent) => {
        event.preventDefault();

        if (number !== null && !held) void save(number);
    };

    const options = [
        { value: 'automatic', label: state ? `Automatic (${state.automatic})` : 'Automatic' },
        { value: 'number', label: 'Number' },
    ];

    return (
        <Stack space="related" data-limit={name}>
            <Choice
                label={label}
                options={options}
                value={shown}
                placeholder="Not reported"
                busy={saving}
                onChange={(next) => {
                    setError(null);

                    if (next === 'automatic') void save('automatic');
                    else {
                        setMode('number');

                        if (typeof saved !== 'number' && state) setTyped(String(state.automatic));
                    }
                }}
            />
            {shown === 'number' && (
                <Inline as="form" space="related" align="center" onSubmit={submit}>
                    <Input
                        presentation="count"
                        inputMode="numeric"
                        aria-label={field}
                        value={text}
                        readOnly={saving}
                        onChange={(e) => setTyped(e.target.value)}
                        aria-invalid={invalid || undefined}
                        aria-describedby={invalid ? hint : undefined}
                    />
                    <Button
                        {...buttonKind('other')}
                        type="submit"
                        disabled={number === null}
                        aria-disabled={held || undefined}
                        pendingLook="disabled"
                        data-save-limit={name}
                    >
                        Save
                    </Button>
                </Inline>
            )}
            {shown === 'number' && invalid && (
                <Text variant="caption" id={hint} tone="muted">
                    Enter a whole number from 1.
                </Text>
            )}
            {state?.problem && (
                <Stack space="related">
                    <Alert size="sm" tone="danger">
                        {state.problem} The board uses Automatic until you save a choice.
                    </Alert>
                    <Button
                        {...buttonKind('other')}
                        loading={saving}
                        data-save-automatic={name}
                        onClick={() => void save('automatic')}
                    >
                        Use Automatic
                    </Button>
                </Stack>
            )}
            {error && (
                <Alert size="sm" tone="danger">
                    {error}
                </Alert>
            )}
        </Stack>
    );
}
