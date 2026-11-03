// Settings uses the same provider groups and keyboard navigation as Start, with its saved model checked.
import { useState } from 'react';
import { flushSync } from 'react-dom';
import type { AutoBuildState, ModelChoice, ModelGroup } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { kind } from '../buttons/button-kinds.tsx';
import { ModelEntries, opensOnChecked } from '../items/model-entries.tsx';
import { postAction, receive } from '../items/card-actions.ts';

function modelLabel(groups: ModelGroup[], selected: ModelChoice | undefined): string {
  if (!selected) return 'T3 default';
  const group = groups.find((g) => g.instanceId === selected.instanceId);
  const model = group?.models.find((m) => m.slug === selected.model);
  return model ? `${group!.name} ${model.label}` : `${selected.instanceId} ${selected.model} (not offered)`;
}

/** Disabled until the board has read the setting, which it never does in sample mode. */
export function AutoBuildModelSetting({ state, groups }: { state: AutoBuildState | undefined; groups: ModelGroup[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (model: ModelChoice | undefined) => {
    flushSync(() => {
      setOpen(false);
      setSaving(true);
      setError(null);
    });
    const result = await postAction('/api/auto-build', { model: model ?? null });
    flushSync(() => {
      receive(result);
      setSaving(false);
      setError(result.error);
    });
  };
  return <div className="grid max-w-80 gap-2" data-auto-build-model>
    <DropdownMenu open={open && !saving} onOpenChange={(next) => setOpen(next && !saving)} modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button {...kind('other')} aria-label="Auto-build model" disabled={!state} aria-busy={saving || undefined}
          aria-disabled={saving || undefined} className="max-w-full">
          <span className="truncate">{saving ? 'Saving…' : modelLabel(groups, state?.model)}</span> ▾
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" aria-label="Auto-build model" {...opensOnChecked}>
        <ModelEntries groups={groups} selected={state?.model} heading="Build with" onPick={(model) => void save(model)} />
      </DropdownMenu.Content>
    </DropdownMenu>
    {error && <p className="m-0 text-xs text-(--error-foreground)" role="alert">{error}</p>}
  </div>;
}
