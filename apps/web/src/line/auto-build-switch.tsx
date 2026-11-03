// The Shaping header's Auto-build switch: this Mac's choice to have the board start eligible Ready builds by itself.
// Sample mode has no Auto-build, so the switch shows off and disabled there.

import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { showToast } from '../notices/toasts.tsx';
import { Switch } from '../settings/controls.tsx';

export function AutoBuildSwitch() {
  const state = useBoardStore((s) => s.data.autoBuild);
  const [saving, setSaving] = useState<boolean | null>(null);

  const save = async (on: boolean) => {
    setSaving(on);
    const result = await postAction('/api/auto-build', { on });
    flushSync(() => {
      receive(result);
      setSaving(null);
      if (result.error) showToast({ slot: 'auto-build', failed: true, what: 'Auto-build', body: <><b>Auto-build</b> {result.error}</> });
    });
  };

  const why = !state ? 'Disabled in sample mode' : state.problem && `${state.problem} Turning it on replaces the file.`;
  return (
    <span className="auto-build inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-(--muted-foreground)" title={why || undefined}>
      <span aria-hidden="true">Auto-build</span>
      <Switch label="Auto-build" on={saving ?? state?.on ?? false} disabled={!state} busy={saving !== null} onChange={(on) => void save(on)} />
    </span>
  );
}
