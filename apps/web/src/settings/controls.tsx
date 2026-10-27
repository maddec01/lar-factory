// The settings rows' controls, on lar-server's copied Switch, RadioGroup, OptionSelect, Input and Button, with the
// prototype's key caps. A row that isn't built yet shows its control disabled, with the reason as its tooltip.

import type { ReactNode } from 'react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Input } from '@lar-factory/ui/design-system/Input';
import { OptionSelect } from '@lar-factory/ui/design-system/OptionSelect';
import { RadioGroup, RadioGroupItem } from '@lar-factory/ui/design-system/RadioGroup';
import { Switch as DesignSwitch } from '@lar-factory/ui/design-system/Switch';

/** A control that shows a value only; the rows that work render their own. */
export type Control =
  | { type: 'switch'; value: boolean }
  | { type: 'select'; options: string[]; value: string }
  | { type: 'radio'; options: string[]; value: string }
  | { type: 'number'; value: number; suffix?: string }
  | { type: 'text'; value: string; mono?: boolean }
  | { type: 'kbd'; keys: string[] }
  | { type: 'button'; label: ReactNode }
  | { type: 'status'; text: string; tone: ToolTone }
  | { type: 'custom'; render: () => ReactNode };

/** The tooltip of something that isn't built yet. */
export const notBuilt = (what: string) => `${what} isn't built yet`;

export function Switch({ on, onChange, disabled, busy, label }: {
  on: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  /** Busy rather than disabled, so focus stays on the switch just pressed. */
  busy?: boolean;
  label?: string;
}) {
  return <DesignSwitch checked={on} aria-label={label} disabled={disabled} aria-disabled={busy} className="aria-disabled:cursor-progress"
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

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-(--border) bg-(--muted) px-1 font-sans text-[10px] text-(--muted-foreground)">{children}</kbd>;
}

/** lar-server's secondary button, disabled with `reason` as its tooltip when it doesn't work here. */
export function SmallButton({ children, reason, onClick, className }: { children: ReactNode; reason?: string; onClick?: () => void; className?: string }) {
  return <Button variant="secondary" className={className} disabled={!!reason} title={reason} onClick={onClick}>{children}</Button>;
}

/** A state's colour; muted for a check that didn't run. */
type ToolTone = 'success' | 'warning' | 'error' | 'muted';

export function ToolState({ text, tone }: { text: string; tone: ToolTone }) {
  const color = { success: 'text-(--success-foreground)', warning: 'text-(--warning-foreground)', error: 'text-(--destructive-foreground)',
    muted: 'text-(--muted-foreground)' }[tone];
  return <span className={`tool-state whitespace-nowrap text-xs font-medium ${color}`}>● {text}</span>;
}

/** A value-only control, disabled, with `reason` as its tooltip. */
export function ShownControl({ control: c, label, reason }: { control: Exclude<Control, { type: 'custom' }>; label: string; reason: string }) {
  const shown = (() => {
    switch (c.type) {
      case 'switch': return <Switch on={c.value} label={label} disabled />;
      case 'select': return <span className="min-w-40"><OptionSelect label={label} value={c.value} options={c.options.map((o) => ({ value: o, label: o }))} disabled onChange={() => {}} /></span>;
      case 'number': return <span className="flex items-center gap-1"><Input className="w-16 text-right tabular-nums" type="number" aria-label={label} value={c.value} disabled readOnly />{c.suffix && <span className="text-xs text-(--muted-foreground)">{c.suffix}</span>}</span>;
      case 'text': return <Input className={`w-52 ${c.mono ? 'font-mono text-xs' : ''}`} aria-label={label} value={c.value} disabled readOnly />;
      case 'kbd': return <span className="flex gap-1">{c.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>;
      case 'button': return <SmallButton reason={reason}>{c.label}</SmallButton>;
      case 'status': return <ToolState text={c.text} tone={c.tone} />;
      case 'radio': return <Choice label={label} options={c.options.map((o) => ({ value: o, label: o }))} value={c.value} disabled />;
    }
  })();
  return <span className="shown-control flex" title={reason}>{shown}</span>;
}
