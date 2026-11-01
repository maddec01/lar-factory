import { useId } from 'react';
import { effectiveIssueSettings } from '@lar-factory/shared';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';

const LABELS = {
  createIssuesFromAddItem: 'Create issues from Add item',
  createIssuesFromRetro: 'Create issues from retro captures',
  writeRefinedSpec: 'Write the refined spec to the issue',
} as const;
export type IssueSetting = keyof typeof LABELS;

/** Both setup screens show effective values while keeping saved preferences intact. */
export function IssueDefaults({ setup, disabled = false, onChange }: {
  setup: Parameters<typeof effectiveIssueSettings>[0]; disabled?: boolean; onChange: (key: IssueSetting, value: boolean) => void;
}) {
  const id = useId();
  const effective = effectiveIssueSettings(setup);
  return <div className="grid gap-4">
    {(Object.keys(LABELS) as IssueSetting[]).map((key) => {
      const reason = key === 'writeRefinedSpec' ? effective.specReason : effective.createReason;
      return <div key={key} data-setting={key} className="grid gap-1.5">
        <Checkbox label={LABELS[key]} checked={effective[key]} disabled={disabled || reason !== null}
          aria-describedby={reason ? `${id}-${key}` : undefined} onChange={() => onChange(key, !effective[key])} />
        {reason && <p id={`${id}-${key}`} className="m-0 pl-7 text-xs text-base-700">{reason}</p>}
      </div>;
    })}
  </div>;
}
