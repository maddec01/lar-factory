// The settings rows' working controls, on the design system's Switch, RadioGroup and Button.

import type { ReactNode } from 'react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RadioGroup, RadioGroupItem } from '@lar-factory/ui/design-system/RadioGroup';
import { Switch as DesignSwitch } from '@lar-factory/ui/design-system/Switch';
import { kind } from '../buttons/button-kinds.tsx';

/** A working row renders its control. Unbuilt settings carry no value. */
export type Control = { type: 'unavailable' } | { type: 'custom'; render: () => ReactNode };

export function Switch({ on, onChange, disabled, busy, label, description }: {
  on: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  /** Busy rather than disabled, so focus stays on the switch just pressed. */
  busy?: boolean;
  label?: string;
  description?: string;
}) {
  return <DesignSwitch checked={on} aria-label={label} aria-description={description} disabled={disabled} aria-disabled={busy} className="aria-disabled:cursor-progress"
    onCheckedChange={(next) => !busy && onChange?.(next)} />;
}

/** A choice of a few options, as a row of radios. */
export function Choice({ label, options, value, onChange, disabled, busy }: {
  label: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Busy rather than disabled, so focus stays on the choice just pressed. */
  busy?: boolean;
}) {
  return (
    <RadioGroup aria-label={label} orientation="horizontal" className="flex gap-4" value={value ?? ''} disabled={disabled}
      onValueChange={(next) => !busy && onChange?.(next)}>
      {options.map((o) => <RadioGroupItem key={o.value} value={o.value} label={o.label} aria-disabled={busy} className="aria-disabled:cursor-progress" />)}
    </RadioGroup>
  );
}

/** lar-server's secondary button, disabled with `reason` as its tooltip when it doesn't work here. */
export function SmallButton({ children, reason, onClick, className }: { children: ReactNode; reason?: string; onClick?: () => void; className?: string }) {
  return <Button {...kind('other')} className={className} disabled={!!reason} title={reason} onClick={onClick}>{children}</Button>;
}

/** A state's colour; muted for a check that didn't run. */
type ToolTone = 'success' | 'warning' | 'error' | 'muted';

export function ToolState({ text, tone }: { text: string; tone: ToolTone }) {
  const color = { success: 'text-(--success-foreground)', warning: 'text-(--warning-foreground)', error: 'text-(--destructive-foreground)',
    muted: 'text-(--muted-foreground)' }[tone];
  return <span className={`tool-state whitespace-nowrap text-xs font-medium ${color}`}>● {text}</span>;
}
