// Settings › General: how many heavy commands, or builds, may run at once on this Mac. Automatic shows the number it
// gives here and applies at once; a number is a whole number from 1, a draft that Settings' footer saves (or Enter).

import type { HeavyCommandLimit, HeavyCommandLimitState } from '@lar-factory/shared';
import { Alert, Button, Input, Stack, Text, useSettingsDraft } from '@lar-works/design-system';
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
    const invalid = number === null;
    const dirty = shown === 'number' && (number !== saved || !!state?.problem);

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

        // The footer keeps the draft and says the save failed; the reason shows beside the field.
        if (result.error) throw new Error(result.error);
    };
    const reset = () => {
        setMode(null);
        setTyped(null);
        setError(null);
    };
    const { submit } = useSettingsDraft({
        dirty,
        invalid,
        save: () => save(number!),
        reset,
        error,
    });
    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        submit();
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

                    if (next === 'automatic') {
                        setTyped(null);
                        void save('automatic').catch(() => {});
                    } else {
                        setMode('number');

                        if (typeof saved !== 'number' && state) setTyped(String(state.automatic));
                    }
                }}
            />
            {shown === 'number' && (
                <form onSubmit={onSubmit}>
                    <Input
                        presentation="count"
                        inputMode="numeric"
                        aria-label={field}
                        value={text}
                        readOnly={saving}
                        onChange={(e) => setTyped(e.target.value)}
                        aria-invalid={(dirty && invalid) || undefined}
                        aria-describedby={dirty && invalid ? hint : undefined}
                    />
                </form>
            )}
            {shown === 'number' && invalid && (
                <Text variant="caption" id={hint} tone="muted">
                    Enter a whole number from 1.
                </Text>
            )}
            {state?.problem && (
                <>
                    <Alert size="sm" tone="danger">
                        {state.problem} The board uses Automatic until you save a choice.
                    </Alert>
                    <span>
                        <Button
                            {...buttonKind('other', { size: 'md' })}
                            loading={saving}
                            data-save-automatic={name}
                            onClick={() => void save('automatic').catch(() => {})}
                        >
                            Use Automatic
                        </Button>
                    </span>
                </>
            )}
            {error && (
                <Alert size="sm" tone="danger">
                    {error}
                </Alert>
            )}
        </Stack>
    );
}
