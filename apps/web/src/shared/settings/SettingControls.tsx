// The settings rows' working controls, on the design system’s Switch, OptionSelect, Button and StatusIndicator.

import type { StatusState } from '@lar-works/design-system';
import { Button, OptionSelect, StatusIndicator, Switch as DesignSwitch } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { buttonKind } from '@/ui/board';

/** A working row renders its control. Unbuilt settings carry no value. */
export type Control = { type: 'unavailable' } | { type: 'custom'; render: () => ReactNode };

export function Switch({
    on,
    onChange,
    disabled,
    busy,
    label,
    description,
}: {
    on: boolean;
    onChange?: (on: boolean) => void;
    disabled?: boolean;
    /** Busy rather than disabled, so focus stays on the switch just pressed. */
    busy?: boolean;
    label?: string;
    description?: string;
}) {
    return (
        <DesignSwitch
            checked={on}
            aria-label={label}
            aria-description={description}
            disabled={disabled}
            aria-disabled={busy}
            busy={busy}
            onCheckedChange={(next) => onChange?.(next)}
        />
    );
}

/** A choice of a few options, in a dropdown. */
export function Choice({
    label,
    options,
    value,
    onChange,
    disabled,
    busy,
    placeholder = 'Not set',
}: {
    label: string;
    options: { value: string; label: string }[];
    value: string | null;
    onChange?: (value: string) => void;
    disabled?: boolean;
    /** Busy rather than disabled, so focus stays on the choice just pressed. */
    busy?: boolean;
    placeholder?: string;
}) {
    return (
        <OptionSelect
            label={label}
            presentation="setting"
            writesOnPick
            placeholder={placeholder}
            value={value ?? ''}
            disabled={disabled}
            aria-disabled={busy}
            busy={busy}
            onChange={(next) => onChange?.(next)}
            options={options.map((option) => ({ value: option.value, label: option.label }))}
        />
    );
}

/** lar-server's secondary button, disabled with `reason` as its tooltip when it doesn't work here. */
export function SmallButton({
    children,
    reason,
    onClick,
    ...data
}: {
    children: ReactNode;
    reason?: string;
    onClick?: () => void;
} & { [key: `data-${string}`]: string | boolean | undefined }) {
    return (
        <Button {...buttonKind('other')} {...data} disabled={!!reason} title={reason} onClick={onClick}>
            {children}
        </Button>
    );
}

/** A state's colour; muted for a check that didn't run. */
type ToolTone = 'success' | 'warning' | 'error' | 'muted';

const states = { success: 'ready', warning: 'waiting', error: 'failed', muted: 'off' } as const;

export function ToolState({ text, tone, state }: { text: string; tone?: ToolTone; state?: StatusState }) {
    return <StatusIndicator state={state ?? states[tone ?? 'muted']} label={text} />;
}
