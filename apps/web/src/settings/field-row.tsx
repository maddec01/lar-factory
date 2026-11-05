import { useId, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Popover } from '@lar-factory/ui/design-system/Popover';

export function HelpTip({ title, children }: { title: string; children: ReactNode }) {
  return <Popover>
    <Popover.Trigger asChild><button type="button" aria-label={`About ${title}`} className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-(--muted-foreground) hover:text-(--foreground)"><CircleHelp className="size-3.5" /></button></Popover.Trigger>
    <Popover.Content width="sm"><div className="max-w-full text-xs leading-5 wrap-anywhere" data-help-text>{children}</div></Popover.Content>
  </Popover>;
}

export function FieldRow({ label, help, description, children, below, error, id }: {
  label: ReactNode; help?: ReactNode; description?: ReactNode; children?: ReactNode; below?: ReactNode; error?: string | undefined; id?: string;
}) {
  const errorId = useId();
  return <div className="settings-row grid min-w-0 gap-2 px-4 py-3" data-row={id} data-setting={id}>
    <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
      <div className="min-w-32 flex-1">
        <div className="settings-row-title flex min-w-0 items-center gap-1.5 text-[13px] font-medium wrap-anywhere">{label}{help && <HelpTip title={typeof label === 'string' ? label : 'this setting'}>{help}</HelpTip>}</div>
        {description && <div className="text-xs text-(--muted-foreground) wrap-anywhere">{description}</div>}
      </div>
      {children && <div className="settings-row-control flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:max-w-[60%] [&>span]:max-w-full [&_button]:max-w-full">{children}</div>}
    </div>
    {below}
    {error && <p id={id ? `${id}-error` : errorId} role="alert" className="m-0 text-xs text-(--error-foreground)">{error}</p>}
  </div>;
}

export const FIELD_GROUP = 'min-w-0 divide-y divide-(--border) rounded-xl border border-(--border) bg-(--card)';
