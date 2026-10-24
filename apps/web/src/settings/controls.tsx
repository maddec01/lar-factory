// The settings rows' controls, from the control room prototype: T3's switch, segmented choice, select, number and
// text fields, key caps and the small outline button. A row that isn't built yet shows its control disabled, with
// the reason as its tooltip.

import type { ReactNode } from 'react';
import { Button } from '@mux-factory/ui/button';
import { NativeSelect } from '@mux-factory/ui/native-select';

/** A control that shows a value only; the rows that work render their own. */
export type Control =
  | { type: 'switch'; value: boolean }
  | { type: 'select'; options: string[]; value: string }
  | { type: 'segmented'; options: string[]; value: string }
  | { type: 'number'; value: number; suffix?: string }
  | { type: 'text'; value: string; mono?: boolean }
  | { type: 'kbd'; keys: string[] }
  | { type: 'button'; label: ReactNode }
  | { type: 'status'; text: string; tone: 'success' | 'warning' | 'error' }
  | { type: 'custom'; render: () => ReactNode };

/** The tooltip of something that isn't built yet. */
export const notBuilt = (what: string) => `${what} isn't built yet`;

const disabledLook = 'disabled:cursor-not-allowed disabled:opacity-64';

export function Switch({ on, onChange, disabled, busy, label }: {
  on: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  /** Busy rather than disabled, so focus stays on the switch just pressed. */
  busy?: boolean;
  label?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} aria-disabled={busy}
      onClick={() => !busy && onChange?.(!on)}
      className={`relative h-4.5 w-8 shrink-0 rounded-full transition-colors aria-disabled:cursor-progress aria-disabled:opacity-70 ${disabledLook} ${on ? 'bg-(--primary)' : 'bg-(--input)'}`}>
      <span className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all ${on ? 'left-4' : 'left-0.5'}`} />
    </button>
  );
}

/** T3's segmented choice, as radios. */
export function Segmented({ label, options, value, onChange, disabled, busy }: {
  label: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Busy rather than disabled, so focus stays on the choice just pressed. */
  busy?: boolean;
}) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex rounded-(--control-radius) bg-(--accent) p-0.5">
      {options.map((o) => (
        <button type="button" role="radio" key={o.value} value={o.value} aria-checked={value === o.value} disabled={disabled} aria-disabled={busy}
          onClick={() => !busy && onChange?.(o.value)}
          className={`h-6 rounded-[calc(var(--control-radius)-2px)] px-2.5 text-xs font-medium aria-disabled:cursor-progress ${disabledLook} ${value === o.value ? 'bg-(--card) text-(--foreground) shadow-sm' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{o.label}</button>
      ))}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-(--border) bg-(--muted) px-1 font-sans text-[10px] text-(--muted-foreground)">{children}</kbd>;
}

/** The prototype's small outline button, disabled with `reason` as its tooltip when it doesn't work here. */
export function SmallButton({ children, reason, onClick, className }: { children: ReactNode; reason?: string; onClick?: () => void; className?: string }) {
  return <Button variant="outline" size="xs" className={className} disabled={!!reason} title={reason} onClick={onClick}>{children}</Button>;
}

export function ToolState({ text, tone }: { text: string; tone: 'success' | 'warning' | 'error' }) {
  const color = { success: 'text-(--success-foreground)', warning: 'text-(--warning-foreground)', error: 'text-(--destructive-foreground)' }[tone];
  return <span className={`tool-state whitespace-nowrap text-xs font-medium ${color}`}>● {text}</span>;
}

const field = `h-7 rounded-(--control-radius) border border-(--input) bg-(--background) px-2 text-[13px] text-(--foreground) ${disabledLook}`;

/** The prototype's mono text field, read-only. */
export function ReadOnlyText({ label, value }: { label: string; value: string }) {
  return <input className={`${field} w-48 font-mono text-xs`} aria-label={label} value={value} readOnly />;
}

/** A value-only control, disabled, with `reason` as its tooltip. */
export function ShownControl({ control: c, label, reason }: { control: Exclude<Control, { type: 'custom' }>; label: string; reason: string }) {
  const shown = (() => {
    switch (c.type) {
      case 'switch': return <Switch on={c.value} label={label} disabled />;
      case 'select': return <NativeSelect className="w-auto" aria-label={label} value={c.value} disabled onChange={() => {}}>{c.options.map((o) => <option key={o}>{o}</option>)}</NativeSelect>;
      case 'number': return <span className="flex items-center gap-1"><input className={`${field} w-16 text-right tabular-nums`} type="number" aria-label={label} value={c.value} disabled readOnly />{c.suffix && <span className="text-xs text-(--muted-foreground)">{c.suffix}</span>}</span>;
      case 'text': return <input className={`${field} w-48 ${c.mono ? 'font-mono text-xs' : ''}`} aria-label={label} value={c.value} disabled readOnly />;
      case 'kbd': return <span className="flex gap-1">{c.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>;
      case 'button': return <SmallButton reason={reason}>{c.label}</SmallButton>;
      case 'status': return <ToolState text={c.text} tone={c.tone} />;
      case 'segmented': return <Segmented label={label} options={c.options.map((o) => ({ value: o, label: o }))} value={c.value} disabled />;
    }
  })();
  return <span className="shown-control flex" title={reason}>{shown}</span>;
}
