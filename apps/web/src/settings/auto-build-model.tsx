// Settings › General: the model Auto-build starts builds on, T3 default or one of the model choices Start offers. A
// saved model the choices no longer offer stays shown, so the setting never seems to change by itself.

import { useState } from 'react';
import { flushSync } from 'react-dom';
import { offers, readChoice, storedChoice } from '@lar-factory/shared';
import type { AutoBuildState, ModelChoice, ModelGroup } from '@lar-factory/shared';
import { OptionSelect } from '@lar-factory/ui/design-system/OptionSelect';
import { postAction, receive } from '../items/card-actions.ts';

/** "T3 default", each offered model as its instance and model name, and a saved model no longer offered. */
function options(groups: ModelGroup[], saved: ModelChoice | undefined) {
  return [
    { value: storedChoice(undefined), label: 'T3 default' },
    ...groups.flatMap((g) => g.models.map((m) => ({ value: storedChoice({ instanceId: g.instanceId, model: m.slug }), label: `${g.name} ${m.label}` }))),
    ...saved && !offers(groups, saved) ? [{ value: storedChoice(saved), label: `${saved.instanceId} ${saved.model} (not offered)`, disabled: true }] : [],
  ];
}

/** Disabled until the board has read the setting, which it never does in sample mode. */
export function AutoBuildModelSetting({ state, groups }: { state: AutoBuildState | undefined; groups: ModelGroup[] }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: string) => {
    setSaving(value);
    setError(null);
    const result = await postAction('/api/auto-build', { model: readChoice(value) ?? null });
    flushSync(() => {
      receive(result);
      setSaving(null);
      setError(result.error);
    });
  };

  return (
    <div className="grid max-w-80 gap-2" data-auto-build-model>
      <OptionSelect label="Auto-build model" options={options(groups, state?.model)} value={saving ?? storedChoice(state?.model)} disabled={!state}
        onChange={(value) => void save(value)} />
      {error && <p className="m-0 text-xs text-(--error-foreground)" role="alert">{error}</p>}
    </div>
  );
}
